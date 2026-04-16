/**
 * Shared plumbing for `hipp0 migrate openclaw` and `hipp0 migrate hermes`.
 *
 * Both commands walk a source directory, produce a `MigrationPlan` (a list
 * of operations — COPY / REWRITE / BACKUP / INGEST), show a preview in
 * dry-run, and apply the plan idempotently. Source files are never modified.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { Hipp0CliError, type CommandResult } from '../types.js';

export interface MigrationFs {
  exists(p: string): Promise<boolean>;
  readFile(p: string): Promise<string>;
  readBinaryFile(p: string): Promise<Uint8Array>;
  writeFile(p: string, content: string | Uint8Array): Promise<void>;
  mkdir(p: string, opts: { recursive: boolean }): Promise<void>;
  readdir(p: string): Promise<string[]>;
  stat(p: string): Promise<{ isDirectory: boolean; size: number }>;
  /** Optional — only used for backup manifests. */
  now?(): Date;
}

export const nodeMigrationFs: MigrationFs = {
  async exists(p) {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  },
  async readFile(p) {
    return fs.readFile(p, 'utf8');
  },
  async readBinaryFile(p) {
    const buf = await fs.readFile(p);
    return new Uint8Array(buf);
  },
  async writeFile(p, content) {
    if (typeof content === 'string') {
      await fs.writeFile(p, content, 'utf8');
    } else {
      await fs.writeFile(p, content);
    }
  },
  async mkdir(p, opts) {
    await fs.mkdir(p, opts);
  },
  async readdir(p) {
    return fs.readdir(p);
  },
  async stat(p) {
    const s = await fs.stat(p);
    return { isDirectory: s.isDirectory(), size: s.size };
  },
};

// ─────────────────────────────────────────────────────────────────────────────

export type MigrationOpKind =
  | 'copy'
  | 'rewrite'
  | 'ingest-memory'
  | 'ingest-skill'
  | 'set-config'
  | 'set-env';

export interface MigrationOp {
  kind: MigrationOpKind;
  /** Source path, for copy / rewrite / ingest-*. */
  source?: string;
  /** Destination path, for copy / rewrite. */
  dest?: string;
  /** For ingest-memory: parsed memory entries (one per line of text). */
  memoryEntries?: readonly string[];
  /** For set-config: key and value. */
  configKey?: string;
  configValue?: unknown;
  /** For set-env: key and value. */
  envKey?: string;
  envValue?: string;
  /** Human-readable summary (what will change). */
  summary: string;
  /** If this operation would overwrite an existing file, the existing byte
   *  count is recorded so the caller can display it. */
  existingBytes?: number;
}

export interface MigrationPlan {
  /** Source kind so the CLI can say "from OpenClaw" vs "from Hermes". */
  kind: 'openclaw' | 'hermes';
  sourceDir: string;
  destDir: string;
  /** All operations to execute, in order. */
  ops: readonly MigrationOp[];
  /** Files we found but don't know how to map (user should review). */
  unmapped: readonly string[];
  /** Paths we skipped for safety (secrets unless preset='full'). */
  skippedForSafety: readonly string[];
}

export interface MigrationReport {
  plan: MigrationPlan;
  applied: number;
  skipped: number;
  /** Files copied into the backup dir before being overwritten. */
  backedUp: readonly string[];
  backupDir: string | null;
  dryRun: boolean;
  /** Count of memory entries that were ingested (for re-embedding). */
  memoryEntriesIngested: number;
}

export interface MigrationExecuteOptions {
  dryRun: boolean;
  preset: 'full' | 'user-data';
  fs: MigrationFs;
  /** Where ~/.hipp0 lives. Default from HIPP0_HOME or ~/.hipp0. */
  destDir: string;
  /** Optional ingest hook — receives memory entries for re-embedding. */
  onIngestMemory?: (entries: readonly string[], source: string) => Promise<void>;
  /** Optional skill ingest hook. */
  onIngestSkill?: (skillDir: string, destDir: string) => Promise<void>;
  /** Optional .env writer (merge, don't overwrite). */
  onSetEnv?: (key: string, value: string) => Promise<void>;
  /** Optional config writer. */
  onSetConfig?: (key: string, value: unknown) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Source auto-detection
// ─────────────────────────────────────────────────────────────────────────────

const OPENCLAW_CANDIDATES = ['.openclaw', '.clawdbot', '.moltbot'];
const HERMES_CANDIDATES = ['.hermes'];

export async function detectOpenClawSource(
  fsys: MigrationFs,
  home: string = homedir(),
): Promise<string | null> {
  for (const dir of OPENCLAW_CANDIDATES) {
    const p = path.join(home, dir);
    if (await fsys.exists(p)) return p;
  }
  return null;
}

export async function detectHermesSource(
  fsys: MigrationFs,
  home: string = homedir(),
): Promise<string | null> {
  for (const dir of HERMES_CANDIDATES) {
    const p = path.join(home, dir);
    if (await fsys.exists(p)) return p;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan execution
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_ENV_KEYS = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GROQ_API_KEY',
  'TELEGRAM_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
  'WHATSAPP_SESSION',
  'HIPP0_BRAVE_API_KEY',
  'GITHUB_TOKEN',
  'LINEAR_API_KEY',
  'NOTION_TOKEN',
]);

export async function executePlan(
  plan: MigrationPlan,
  opts: MigrationExecuteOptions,
): Promise<MigrationReport> {
  const backupDir = opts.dryRun
    ? null
    : path.join(opts.destDir, `migration-${timestamp(opts.fs)}`);
  if (backupDir) {
    await opts.fs.mkdir(backupDir, { recursive: true });
  }

  let applied = 0;
  let skipped = 0;
  const backedUp: string[] = [];
  let memoryEntriesIngested = 0;

  for (const op of plan.ops) {
    if (opts.preset === 'user-data' && (op.kind === 'set-env' || op.kind === 'set-config')) {
      skipped += 1;
      continue;
    }
    if (op.kind === 'set-env' && op.envKey && !ALLOWED_ENV_KEYS.has(op.envKey)) {
      skipped += 1;
      continue;
    }

    if (opts.dryRun) {
      applied += 1;
      continue;
    }

    switch (op.kind) {
      case 'copy': {
        if (!op.source || !op.dest) break;
        if (await opts.fs.exists(op.dest)) {
          const backupPath = path.join(backupDir!, path.relative(opts.destDir, op.dest));
          await opts.fs.mkdir(path.dirname(backupPath), { recursive: true });
          await opts.fs.writeFile(backupPath, await opts.fs.readBinaryFile(op.dest));
          backedUp.push(op.dest);
        }
        await opts.fs.mkdir(path.dirname(op.dest), { recursive: true });
        await opts.fs.writeFile(op.dest, await opts.fs.readBinaryFile(op.source));
        applied += 1;
        break;
      }
      case 'rewrite': {
        if (!op.source || !op.dest) break;
        const text = await opts.fs.readFile(op.source);
        if (await opts.fs.exists(op.dest)) {
          const backupPath = path.join(backupDir!, path.relative(opts.destDir, op.dest));
          await opts.fs.mkdir(path.dirname(backupPath), { recursive: true });
          await opts.fs.writeFile(backupPath, await opts.fs.readFile(op.dest));
          backedUp.push(op.dest);
        }
        await opts.fs.mkdir(path.dirname(op.dest), { recursive: true });
        await opts.fs.writeFile(op.dest, text);
        applied += 1;
        break;
      }
      case 'ingest-memory': {
        if (opts.onIngestMemory && op.memoryEntries && op.memoryEntries.length > 0) {
          await opts.onIngestMemory(op.memoryEntries, op.source ?? '(unknown)');
          memoryEntriesIngested += op.memoryEntries.length;
        }
        applied += 1;
        break;
      }
      case 'ingest-skill': {
        if (opts.onIngestSkill && op.source && op.dest) {
          await opts.onIngestSkill(op.source, op.dest);
        }
        applied += 1;
        break;
      }
      case 'set-config': {
        if (opts.onSetConfig && op.configKey !== undefined) {
          await opts.onSetConfig(op.configKey, op.configValue);
        }
        applied += 1;
        break;
      }
      case 'set-env': {
        if (opts.onSetEnv && op.envKey && op.envValue !== undefined) {
          await opts.onSetEnv(op.envKey, op.envValue);
        }
        applied += 1;
        break;
      }
    }
  }

  return {
    plan,
    applied,
    skipped,
    backedUp,
    backupDir,
    dryRun: opts.dryRun,
    memoryEntriesIngested,
  };
}

function timestamp(fsys: MigrationFs): string {
  const d = fsys.now?.() ?? new Date();
  return d.toISOString().replace(/[:.]/g, '-');
}

// ─────────────────────────────────────────────────────────────────────────────
// Common parsers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a MEMORY.md-style file into discrete entries. Both OpenClaw and
 * Hermes use similar conventions: YAML-ish `---` frontmatter separators or
 * `## <title>` markdown headings delimit entries. We split on either.
 */
export function parseMemoryEntries(markdown: string): string[] {
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  // Try frontmatter-delimited (---).
  if (/^---\s*\n/.test(normalized)) {
    return normalized
      .split(/\n---\s*\n/g)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // Try `## ` headings.
  const parts = normalized.split(/^## (?=\S)/m).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts.map((p) => `## ${p}`);
  // Otherwise: one entry per paragraph (blank-line separated).
  return normalized.split(/\n{2,}/g).map((s) => s.trim()).filter(Boolean);
}

/**
 * Walk a directory recursively and return relative paths. Honors a simple
 * ignore list (node_modules, .git, etc.).
 */
export async function walkDir(
  fsys: MigrationFs,
  root: string,
  ignore: readonly string[] = ['node_modules', '.git', '.cache'],
  maxDepth = 6,
): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > maxDepth) return;
    const entries = await fsys.readdir(dir).catch(() => [] as string[]);
    for (const name of entries) {
      if (ignore.includes(name)) continue;
      const full = path.join(dir, name);
      const s = await fsys.stat(full).catch(() => null);
      if (!s) continue;
      if (s.isDirectory) await walk(full, depth + 1);
      else out.push(path.relative(root, full));
    }
  }
  await walk(root, 0);
  return out.sort();
}

/**
 * Format a migration plan for human review. Intentionally plain-text (no
 * colors) so it's suitable for both stdout and CI logs.
 */
export function formatPlan(plan: MigrationPlan, preset: 'full' | 'user-data'): string {
  const lines: string[] = [];
  lines.push(`Migration plan (${plan.kind}, preset=${preset})`);
  lines.push(`  source: ${plan.sourceDir}`);
  lines.push(`  dest:   ${plan.destDir}`);
  lines.push(`  ops:    ${plan.ops.length}`);
  for (const op of plan.ops) {
    lines.push(`    [${op.kind}] ${op.summary}`);
  }
  if (plan.unmapped.length > 0) {
    lines.push(`  unmapped (${plan.unmapped.length}): ${plan.unmapped.slice(0, 6).join(', ')}${plan.unmapped.length > 6 ? '…' : ''}`);
  }
  if (plan.skippedForSafety.length > 0) {
    lines.push(`  skipped-for-safety (${plan.skippedForSafety.length}): ${plan.skippedForSafety.slice(0, 6).join(', ')}`);
  }
  return lines.join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Higher-level runner used by both `migrate openclaw` and `migrate hermes`.
// Returns a CommandResult so the CLI wiring is trivial.
// ─────────────────────────────────────────────────────────────────────────────

export interface RunMigrateCommonOptions {
  /** Must return the plan for the detected source. */
  buildPlan(sourceDir: string): Promise<MigrationPlan>;
  sourceDir?: string;
  autoDetect: (fsys: MigrationFs) => Promise<string | null>;
  preset?: 'full' | 'user-data';
  dryRun?: boolean;
  nonInteractive?: boolean;
  destDir?: string;
  fs?: MigrationFs;
  onIngestMemory?: MigrationExecuteOptions['onIngestMemory'];
  onIngestSkill?: MigrationExecuteOptions['onIngestSkill'];
  onSetEnv?: MigrationExecuteOptions['onSetEnv'];
  onSetConfig?: MigrationExecuteOptions['onSetConfig'];
}

export async function runMigrateCommon(
  opts: RunMigrateCommonOptions,
): Promise<CommandResult & { report?: MigrationReport }> {
  const fsys = opts.fs ?? nodeMigrationFs;
  const destDir = opts.destDir ?? (process.env['HIPP0_HOME'] ?? path.join(homedir(), '.hipp0'));
  const sourceDir = opts.sourceDir ?? (await opts.autoDetect(fsys));
  if (!sourceDir) {
    throw new Hipp0CliError(
      'No source directory detected. Pass --source /path/to/agent-dir.',
      'HIPP0_CLI_MIGRATE_NO_SOURCE',
    );
  }
  if (!(await fsys.exists(sourceDir))) {
    throw new Hipp0CliError(
      `Source directory does not exist: ${sourceDir}`,
      'HIPP0_CLI_MIGRATE_NO_SOURCE',
    );
  }
  const plan = await opts.buildPlan(sourceDir);
  const preset = opts.preset ?? 'user-data';
  // Default to dry-run when non-interactive and --dry-run not explicitly set to false.
  const dryRun = opts.dryRun ?? opts.nonInteractive === true;
  const executeOpts: MigrationExecuteOptions = {
    dryRun,
    preset,
    fs: fsys,
    destDir,
    ...(opts.onIngestMemory && { onIngestMemory: opts.onIngestMemory }),
    ...(opts.onIngestSkill && { onIngestSkill: opts.onIngestSkill }),
    ...(opts.onSetEnv && { onSetEnv: opts.onSetEnv }),
    ...(opts.onSetConfig && { onSetConfig: opts.onSetConfig }),
  };
  const report = await executePlan(plan, executeOpts);
  const lines = [
    ...formatPlan(plan, preset).split('\n'),
    '',
    dryRun
      ? `Dry-run: would apply ${report.applied} op(s), skip ${report.skipped}`
      : `Applied ${report.applied} op(s), skipped ${report.skipped}, backed up ${report.backedUp.length} file(s)`,
  ];
  if (report.backupDir) lines.push(`  backup: ${report.backupDir}`);
  if (report.memoryEntriesIngested > 0) {
    lines.push(`  memory entries ingested: ${report.memoryEntriesIngested}`);
  }
  return { exitCode: 0, stdout: lines, report };
}
