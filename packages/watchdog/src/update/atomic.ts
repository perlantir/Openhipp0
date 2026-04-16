/**
 * AtomicUpdater — orchestrates the safe-update pipeline:
 *
 *   backup → migrate → smokeTest → commit
 *                  ↓ (any failure)
 *               rollback (restore backup, drop in-flight migration state)
 *
 * The updater never throws on a stage failure — it captures the error, runs
 * rollback, and returns a structured UpdateResult so callers (CLI / dashboard)
 * can render the failure detail.
 *
 * Rollback IS allowed to throw (Hipp0RollbackFailedError) — at that point
 * the state is unrecoverable by the watchdog package and the caller has to
 * notify a human.
 */

import { createBackup, type BackupHandle } from './backup.js';
import {
  Hipp0RollbackFailedError,
  type BackupOptions,
  type UpdatePlanStage,
  type UpdateResult,
} from './types.js';

export interface AtomicUpdateOptions {
  backup: BackupOptions;
  /** Run the migration step. Throw on failure. */
  migrate: () => Promise<void>;
  /** Verify the post-migration system; throw on failure. */
  smokeTest: () => Promise<void>;
  /** Optional commit step — finalize the upgrade (e.g. flip a version pointer). */
  commit?: () => Promise<void>;
  /** When true, run only the backup step; never apply changes. */
  dryRun?: boolean;
}

export class AtomicUpdater {
  async run(opts: AtomicUpdateOptions): Promise<UpdateResult> {
    const startedAt = Date.now();
    const stages: UpdatePlanStage[] = [];

    // 1) Backup
    const backupStage = await timed('backup', () => createBackup(opts.backup));
    stages.push(backupStage.stage);
    if (!backupStage.stage.ok) {
      return finalize(startedAt, 'rollback_failed', stages, undefined);
    }
    const backup: BackupHandle = backupStage.value as BackupHandle;

    if (opts.dryRun) {
      stages.push({
        name: 'commit',
        ok: false,
        durationMs: 0,
        message: 'dry-run; no changes applied',
      });
      return finalize(startedAt, 'aborted_dry_run', stages, backup);
    }

    // 2) Migrate
    const migrate = await timed('migrate', opts.migrate);
    stages.push(migrate.stage);
    if (!migrate.stage.ok) return await rollback(startedAt, stages, backup);

    // 3) Smoke
    const smoke = await timed('smoke', opts.smokeTest);
    stages.push(smoke.stage);
    if (!smoke.stage.ok) return await rollback(startedAt, stages, backup);

    // 4) Commit (optional)
    if (opts.commit) {
      const commit = await timed('commit', opts.commit);
      stages.push(commit.stage);
      if (!commit.stage.ok) return await rollback(startedAt, stages, backup);
    } else {
      stages.push({ name: 'commit', ok: true, durationMs: 0 });
    }

    return finalize(startedAt, 'success', stages, backup);
  }
}

interface Timed {
  stage: UpdatePlanStage;
  value: unknown;
}

async function timed<T>(name: UpdatePlanStage['name'], fn: () => Promise<T>): Promise<Timed> {
  const start = Date.now();
  try {
    const value = await fn();
    return { stage: { name, ok: true, durationMs: Date.now() - start }, value };
  } catch (err) {
    return {
      stage: {
        name,
        ok: false,
        durationMs: Date.now() - start,
        message: err instanceof Error ? err.message : String(err),
        error: err,
      },
      value: undefined,
    };
  }
}

async function rollback(
  startedAt: number,
  stages: UpdatePlanStage[],
  backup: BackupHandle,
): Promise<UpdateResult> {
  const rb = await timed('rollback', () => backup.restore());
  stages.push(rb.stage);
  if (!rb.stage.ok) {
    throw new Hipp0RollbackFailedError(
      `Rollback after failed update could not be applied: ${rb.stage.message ?? 'unknown'}`,
      rb.stage.error,
    );
  }
  return finalize(startedAt, 'rolled_back', stages, backup);
}

function finalize(
  startedAt: number,
  status: UpdateResult['status'],
  stages: UpdatePlanStage[],
  backup: BackupHandle | undefined,
): UpdateResult {
  return {
    status,
    startedAt,
    totalDurationMs: Date.now() - startedAt,
    stages,
    ...(backup ? { backupHandle: backup.artifact } : {}),
  };
}
