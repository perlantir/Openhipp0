/**
 * `hipp0 migrate | benchmark | update` — housekeeping commands.
 *
 *   migrate dump <out>       copy the sqlite DB file to <out>
 *   migrate restore <in>     copy <in> into the sqlite DB location (requires --force)
 *   migrate copy <src> <dst> file-to-file copy (for moving between boxes)
 *   benchmark [--suite all]  print an inventory of benchmark suites and how to run them
 *   update [--dry-run]       print guidance; wired to @openhipp0/watchdog in Phase 8
 *
 * `migrate` is scoped to SQLite (local dev). Postgres backup/restore is left
 * to pg_dump/pg_restore; the command emits a helpful pointer instead.
 * `benchmark` does not spawn child processes — just reports what's available
 * so operators can run them directly from the repo.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { db as memoryDb } from '@openhipp0/memory';
import { Hipp0CliError, type CommandResult } from '../types.js';

export interface MigrateOptions {
  force?: boolean;
  /** Injectable copyFile for tests. */
  copyFile?: (src: string, dst: string) => Promise<void>;
  /** Injectable pathResolver — in prod resolves the DB path via memory's helper. */
  resolveDbPath?: () => string;
}

function defaultResolveDbPath(): string {
  // Honor DATABASE_URL if set; otherwise ~/.hipp0/hipp0.db.
  try {
    if (process.env['DATABASE_URL']) {
      return memoryDb.resolveSqlitePath({ databaseUrl: process.env['DATABASE_URL'] });
    }
  } catch (err) {
    // Postgres URLs aren't migratable via file copy; surface the error.
    throw new Hipp0CliError(
      `Cannot file-copy a non-SQLite DATABASE_URL: ${(err as Error).message}. Use pg_dump/pg_restore instead.`,
      'HIPP0_CLI_MIGRATE_NOT_SQLITE',
    );
  }
  return memoryDb.resolveSqlitePath();
}

export async function runMigrateDump(
  outPath: string,
  opts: MigrateOptions = {},
): Promise<CommandResult> {
  const resolveDbPath = opts.resolveDbPath ?? defaultResolveDbPath;
  const copyFile = opts.copyFile ?? ((s, d) => fs.copyFile(s, d));
  const src = resolveDbPath();
  if (src === ':memory:') {
    throw new Hipp0CliError(
      'Cannot dump an in-memory database.',
      'HIPP0_CLI_MIGRATE_IN_MEMORY',
    );
  }
  const abs = path.resolve(outPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await copyFile(src, abs);
  return { exitCode: 0, stdout: [`✓ Dumped ${src} → ${abs}`], data: { src, dst: abs } };
}

export async function runMigrateRestore(
  inPath: string,
  opts: MigrateOptions = {},
): Promise<CommandResult> {
  const resolveDbPath = opts.resolveDbPath ?? defaultResolveDbPath;
  const copyFile = opts.copyFile ?? ((s, d) => fs.copyFile(s, d));
  const dst = resolveDbPath();
  if (dst === ':memory:') {
    throw new Hipp0CliError(
      'Cannot restore into an in-memory database.',
      'HIPP0_CLI_MIGRATE_IN_MEMORY',
    );
  }
  if (!opts.force) {
    throw new Hipp0CliError(
      `Restore overwrites ${dst}. Re-run with --force to proceed.`,
      'HIPP0_CLI_MIGRATE_NO_FORCE',
    );
  }
  const abs = path.resolve(inPath);
  await fs.mkdir(path.dirname(dst), { recursive: true });
  await copyFile(abs, dst);
  return { exitCode: 0, stdout: [`✓ Restored ${abs} → ${dst}`], data: { src: abs, dst } };
}

export async function runMigrateCopy(
  src: string,
  dst: string,
  opts: MigrateOptions = {},
): Promise<CommandResult> {
  const copyFile = opts.copyFile ?? ((s, d) => fs.copyFile(s, d));
  const absSrc = path.resolve(src);
  const absDst = path.resolve(dst);
  await fs.mkdir(path.dirname(absDst), { recursive: true });
  await copyFile(absSrc, absDst);
  return { exitCode: 0, stdout: [`✓ Copied ${absSrc} → ${absDst}`], data: { src: absSrc, dst: absDst } };
}

export interface BenchmarkOptions {
  suite?: string;
}

export async function runBenchmark(opts: BenchmarkOptions = {}): Promise<CommandResult> {
  const suite = opts.suite ?? 'all';
  const available = [
    { name: 'memory', command: 'pnpm --filter @openhipp0/memory test:bench' },
    { name: 'scheduler', command: 'pnpm --filter @openhipp0/scheduler test:bench' },
  ];
  const selected = suite === 'all' ? available : available.filter((s) => s.name === suite);
  if (selected.length === 0) {
    throw new Hipp0CliError(
      `Unknown benchmark suite: ${suite}. Available: ${available.map((s) => s.name).join(', ')}, all.`,
      'HIPP0_CLI_BENCH_UNKNOWN',
    );
  }
  const lines: string[] = [`Benchmark suites (${suite}):`];
  for (const s of selected) {
    lines.push(`  ${s.name.padEnd(12)} ${s.command}`);
  }
  lines.push('');
  lines.push(`Run any of the above from the repo root to execute the suite.`);
  return { exitCode: 0, stdout: lines, data: { suite, available: selected } };
}

export interface UpdateOptions {
  dryRun?: boolean;
  rollback?: boolean;
  canary?: boolean;
}

export async function runUpdate(opts: UpdateOptions = {}): Promise<CommandResult> {
  const modes: string[] = [];
  if (opts.dryRun) modes.push('dry-run');
  if (opts.rollback) modes.push('rollback');
  if (opts.canary) modes.push('canary');
  const modeLabel = modes.length === 0 ? 'default' : modes.join('+');
  return {
    exitCode: 0,
    stdout: [
      `hipp0 update (${modeLabel}): operator tooling ships in Phase 8.`,
      '  See @openhipp0/watchdog: AtomicUpdater / CanaryUpdater / BackupHandle.',
      '  Dashboards and CI integrations land with the Phase 8 release.',
    ],
    data: { modes },
  };
}
