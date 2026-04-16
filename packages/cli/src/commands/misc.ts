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
  check?: boolean;
  /** Injected fetch for tests. */
  fetch?: typeof fetch;
  /** Injected exec for tests (runs npm install / hipp0 doctor). */
  exec?: (cmd: string) => Promise<{ stdout: string; stderr: string; code: number }>;
  /** Current version — defaults to the CLI package version. */
  currentVersion?: string;
}

interface NpmPackument {
  'dist-tags'?: { latest?: string; canary?: string };
}

async function fetchLatest(
  channel: 'latest' | 'canary',
  fetcher: typeof fetch,
): Promise<string | null> {
  try {
    const resp = await fetcher('https://registry.npmjs.org/@openhipp0/cli', {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as NpmPackument;
    return data['dist-tags']?.[channel] ?? null;
  } catch {
    return null;
  }
}

async function defaultExec(cmd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  const { exec } = await import('node:child_process');
  return new Promise((resolve) => {
    exec(cmd, { maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ stdout, stderr, code: err ? (err as NodeJS.ErrnoException).code === undefined ? 1 : 1 : 0 });
    });
  });
}

export async function runUpdate(opts: UpdateOptions = {}): Promise<CommandResult> {
  const fetcher = opts.fetch ?? fetch;
  const exec = opts.exec ?? defaultExec;
  const current = opts.currentVersion ?? '0.0.0';

  if (opts.check) {
    const latest = await fetchLatest('latest', fetcher);
    return {
      exitCode: 0,
      stdout: [
        `current:  ${current}`,
        `latest:   ${latest ?? '(registry unreachable)'}`,
        latest && latest !== current
          ? `→ run ${`\`hipp0 update\``} to upgrade`
          : `→ up to date`,
      ],
      data: { current, latest },
    };
  }

  if (opts.rollback) {
    const result = await exec('npm install -g @openhipp0/cli@previous');
    return {
      exitCode: result.code === 0 ? 0 : 1,
      stdout: [`rollback: ${result.code === 0 ? 'succeeded' : 'failed'}`, result.stdout.trim()].filter(Boolean),
      ...(result.stderr && { stderr: [result.stderr] }),
    };
  }

  const channel: 'latest' | 'canary' = opts.canary ? 'canary' : 'latest';
  const target = await fetchLatest(channel, fetcher);
  if (!target) {
    return { exitCode: 1, stderr: ['npm registry unreachable; cannot determine target version.'] };
  }
  if (target === current && !opts.canary) {
    return { exitCode: 0, stdout: [`already on ${current}.`] };
  }
  if (opts.dryRun) {
    return {
      exitCode: 0,
      stdout: [`would upgrade ${current} → ${target} (${channel})`],
      data: { current, target, channel },
    };
  }

  // Backup ~/.hipp0/config.json before doing anything destructive.
  const home = process.env['HIPP0_HOME'] ?? `${process.env['HOME']}/.hipp0`;
  const backupPath = `${home}/config.backup.${Date.now()}.json`;
  await exec(`cp -f ${home}/config.json ${backupPath} 2>/dev/null || true`);

  const installCmd = `npm install -g @openhipp0/cli@${target}`;
  const installResult = await exec(installCmd);
  if (installResult.code !== 0) {
    return { exitCode: 1, stderr: [`install failed: ${installResult.stderr}`] };
  }

  // Post-install doctor — if it fails, auto-rollback.
  const doctor = await exec('hipp0 doctor');
  if (doctor.code !== 0) {
    await exec(`npm install -g @openhipp0/cli@${current}`);
    return {
      exitCode: 1,
      stderr: [
        `post-upgrade doctor failed; rolled back to ${current}.`,
        `config backup preserved at ${backupPath}`,
      ],
    };
  }

  return {
    exitCode: 0,
    stdout: [
      `upgraded ${current} → ${target} (${channel})`,
      `config backup: ${backupPath}`,
    ],
    data: { from: current, to: target, channel, backupPath },
  };
}
