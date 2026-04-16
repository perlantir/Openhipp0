/**
 * Safe-update public types.
 *
 * Phase 4c models a software update as a four-stage pipeline:
 *   backup → migrate → smokeTest → (commit | rollback)
 *
 * Each stage is a caller-supplied callback (no Drizzle/git/npm hardcoding in
 * the watchdog package). The `AtomicUpdater` orchestrates the sequence and
 * calls `rollback()` on any non-success.
 *
 * Canary is an *extension* of the same pipeline that interleaves an
 * "observation window" of additional smoke probes between migrate and commit.
 */

export type UpdateStatus = 'success' | 'rolled_back' | 'rollback_failed' | 'aborted_dry_run';

export interface UpdatePlanStage {
  name: 'backup' | 'migrate' | 'smoke' | 'observe' | 'commit' | 'rollback';
  ok: boolean;
  durationMs: number;
  message?: string;
  error?: unknown;
}

export interface UpdateResult {
  status: UpdateStatus;
  startedAt: number;
  totalDurationMs: number;
  stages: UpdatePlanStage[];
  /** Token returned by backup() — opaque handle for rollback(). */
  backupHandle?: unknown;
}

export interface BackupArtifact {
  /** Absolute path to where the backup was written. */
  path: string;
  /** ISO-8601 UTC. */
  takenAt: string;
  /** Caller-supplied tag for the backup (e.g. version being replaced). */
  label?: string;
  /** Per-source bytes written (sum). */
  bytes: number;
}

export interface BackupOptions {
  /** Sources to back up. Files OR directories. */
  sources: readonly string[];
  /** Destination directory; a timestamped subdir is created inside it. */
  destDir: string;
  label?: string;
}

export class Hipp0UpdateError extends Error {
  readonly code: string;
  override readonly cause: unknown;
  constructor(message: string, code = 'HIPP0_UPDATE_ERROR', cause?: unknown) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.cause = cause;
  }
}

export class Hipp0BackupError extends Hipp0UpdateError {
  constructor(message: string, cause?: unknown) {
    super(message, 'HIPP0_BACKUP_ERROR', cause);
  }
}

export class Hipp0RollbackFailedError extends Hipp0UpdateError {
  constructor(message: string, cause?: unknown) {
    super(message, 'HIPP0_ROLLBACK_FAILED', cause);
  }
}
