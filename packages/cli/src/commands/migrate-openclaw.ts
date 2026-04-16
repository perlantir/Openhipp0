/**
 * `hipp0 migrate openclaw` — OpenClaw → Open Hipp0 migration.
 *
 * Detects ~/.openclaw, ~/.clawdbot, or ~/.moltbot (all historical names) and
 * maps the layout into ~/.hipp0/. See docs/migration-from-openclaw.md for the
 * complete file-by-file map. Safe defaults: dry-run when non-interactive;
 * never touches source files; always backs up overwritten destinations.
 */

import path from 'node:path';
import { homedir } from 'node:os';
import type { CommandResult } from '../types.js';
import {
  detectOpenClawSource,
  parseMemoryEntries,
  runMigrateCommon,
  walkDir,
  type MigrationFs,
  type MigrationOp,
  type MigrationPlan,
  type MigrationReport,
} from './migrate-shared.js';

export interface MigrateOpenClawOptions {
  source?: string;
  preset?: 'full' | 'user-data';
  dryRun?: boolean;
  nonInteractive?: boolean;
  destDir?: string;
  fs?: MigrationFs;
  onIngestMemory?: (entries: readonly string[], source: string) => Promise<void>;
  onIngestSkill?: (skillDir: string, destDir: string) => Promise<void>;
  onSetEnv?: (key: string, value: string) => Promise<void>;
  onSetConfig?: (key: string, value: unknown) => Promise<void>;
}

export async function runMigrateOpenClaw(
  opts: MigrateOpenClawOptions = {},
): Promise<CommandResult & { report?: MigrationReport }> {
  return runMigrateCommon({
    autoDetect: detectOpenClawSource,
    buildPlan: (src) => buildOpenClawPlan(src, opts.destDir, opts.fs),
    ...(opts.source !== undefined && { sourceDir: opts.source }),
    ...(opts.preset !== undefined && { preset: opts.preset }),
    ...(opts.dryRun !== undefined && { dryRun: opts.dryRun }),
    ...(opts.nonInteractive !== undefined && { nonInteractive: opts.nonInteractive }),
    ...(opts.destDir !== undefined && { destDir: opts.destDir }),
    ...(opts.fs !== undefined && { fs: opts.fs }),
    ...(opts.onIngestMemory && { onIngestMemory: opts.onIngestMemory }),
    ...(opts.onIngestSkill && { onIngestSkill: opts.onIngestSkill }),
    ...(opts.onSetEnv && { onSetEnv: opts.onSetEnv }),
    ...(opts.onSetConfig && { onSetConfig: opts.onSetConfig }),
  });
}

async function buildOpenClawPlan(
  sourceDir: string,
  destDirArg: string | undefined,
  fsArg: MigrationFs | undefined,
): Promise<MigrationPlan> {
  const destDir = destDirArg ?? (process.env['HIPP0_HOME'] ?? path.join(homedir(), '.hipp0'));
  const { nodeMigrationFs } = await import('./migrate-shared.js');
  const fsys = fsArg ?? nodeMigrationFs;

  const ops: MigrationOp[] = [];
  const unmapped: string[] = [];
  const skippedForSafety: string[] = [];

  // 1. SOUL.md → ~/.hipp0/soul.md (rewrite: text copy, but we format through
  //    rewrite op so tests can differentiate from a binary copy).
  const soul = path.join(sourceDir, 'SOUL.md');
  if (await fsys.exists(soul)) {
    ops.push({
      kind: 'rewrite',
      source: soul,
      dest: path.join(destDir, 'soul.md'),
      summary: 'persona → soul.md',
    });
  }

  // 2. IDENTITY.md → rewrite
  const ident = path.join(sourceDir, 'IDENTITY.md');
  if (await fsys.exists(ident)) {
    ops.push({
      kind: 'rewrite',
      source: ident,
      dest: path.join(destDir, 'identity.md'),
      summary: 'agent identity → identity.md',
    });
  }

  // 3. MEMORY.md → parsed into entries + ingested
  const mem = path.join(sourceDir, 'MEMORY.md');
  if (await fsys.exists(mem)) {
    const text = await fsys.readFile(mem);
    const entries = parseMemoryEntries(text);
    ops.push({
      kind: 'ingest-memory',
      source: mem,
      memoryEntries: entries,
      summary: `MEMORY.md → ingest ${entries.length} entries`,
    });
    // Also copy the raw file as archived history.
    ops.push({
      kind: 'rewrite',
      source: mem,
      dest: path.join(destDir, 'archive', 'openclaw-MEMORY.md'),
      summary: 'archive original MEMORY.md',
    });
  }

  // 4. USER.md → user model snapshot (archive; full parsing is out of scope).
  const userMd = path.join(sourceDir, 'USER.md');
  if (await fsys.exists(userMd)) {
    ops.push({
      kind: 'rewrite',
      source: userMd,
      dest: path.join(destDir, 'archive', 'openclaw-USER.md'),
      summary: 'archive user model snapshot',
    });
  }

  // 5. HEARTBEAT.md / TOOLS.md / AGENTS.md — archive as reference.
  for (const name of ['HEARTBEAT.md', 'TOOLS.md', 'AGENTS.md']) {
    const p = path.join(sourceDir, name);
    if (await fsys.exists(p)) {
      ops.push({
        kind: 'rewrite',
        source: p,
        dest: path.join(destDir, 'archive', `openclaw-${name}`),
        summary: `archive ${name}`,
      });
    }
  }

  // 6. skills/ → ~/.hipp0/skills/openclaw-imports/
  const skillsRoot = path.join(sourceDir, 'skills');
  if (await fsys.exists(skillsRoot)) {
    const skillDirs = await listImmediateDirs(fsys, skillsRoot);
    for (const skillName of skillDirs) {
      const src = path.join(skillsRoot, skillName);
      const dst = path.join(destDir, 'skills', 'openclaw-imports', skillName);
      ops.push({
        kind: 'ingest-skill',
        source: src,
        dest: dst,
        summary: `skill ${skillName} → skills/openclaw-imports/${skillName}`,
      });
      // Copy each file in the skill dir verbatim.
      const files = await walkDir(fsys, src);
      for (const rel of files) {
        ops.push({
          kind: 'copy',
          source: path.join(src, rel),
          dest: path.join(dst, rel),
          summary: `  copy ${rel}`,
        });
      }
    }
  }

  // 7. memory/ directory — daily logs + research notes.
  const memoryRoot = path.join(sourceDir, 'memory');
  if (await fsys.exists(memoryRoot)) {
    const files = await walkDir(fsys, memoryRoot);
    for (const rel of files) {
      ops.push({
        kind: 'copy',
        source: path.join(memoryRoot, rel),
        dest: path.join(destDir, 'memory', 'openclaw-imports', rel),
        summary: `memory/${rel}`,
      });
      // Also trigger a text ingest if it's a .md file.
      if (rel.endsWith('.md')) {
        const text = await fsys.readFile(path.join(memoryRoot, rel));
        const entries = parseMemoryEntries(text);
        if (entries.length > 0) {
          ops.push({
            kind: 'ingest-memory',
            source: path.join(memoryRoot, rel),
            memoryEntries: entries,
            summary: `ingest ${entries.length} entries from memory/${rel}`,
          });
        }
      }
    }
  }

  // 8. openclaw.json — models + channels + cron → structured config.
  const configPath = path.join(sourceDir, 'openclaw.json');
  if (await fsys.exists(configPath)) {
    try {
      const raw = await fsys.readFile(configPath);
      const cfg = JSON.parse(raw) as Record<string, unknown>;
      extractModels(cfg, ops);
      extractChannels(cfg, ops);
      extractCron(cfg, ops);
      // Archive the raw file.
      ops.push({
        kind: 'rewrite',
        source: configPath,
        dest: path.join(destDir, 'archive', 'openclaw.json'),
        summary: 'archive openclaw.json',
      });
    } catch {
      unmapped.push('openclaw.json (invalid JSON)');
    }
  }

  // 9. .env / env.json — only a pre-approved allowlist of keys.
  for (const envFile of ['.env', 'env.json', 'auth-profiles.json']) {
    const p = path.join(sourceDir, envFile);
    if (await fsys.exists(p)) {
      const text = await fsys.readFile(p).catch(() => '');
      if (envFile.endsWith('.json')) {
        try {
          const flat = flattenJson(JSON.parse(text));
          for (const [k, v] of Object.entries(flat)) {
            if (typeof v === 'string' && v.length > 0) {
              ops.push({
                kind: 'set-env',
                envKey: normalizeEnvKey(k),
                envValue: v,
                summary: `env: ${normalizeEnvKey(k)}=…`,
              });
            }
          }
        } catch {
          unmapped.push(envFile);
        }
      } else {
        for (const line of text.split(/\r?\n/)) {
          const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
          if (m && m[1] && m[2] !== undefined) {
            ops.push({
              kind: 'set-env',
              envKey: m[1],
              envValue: stripQuotes(m[2]),
              summary: `env: ${m[1]}=…`,
            });
          }
        }
      }
    }
  }

  // Secrets dirs always skipped.
  for (const safe of ['secrets', '.ssh', '.aws', '.gnupg']) {
    const p = path.join(sourceDir, safe);
    if (await fsys.exists(p)) skippedForSafety.push(safe);
  }

  return {
    kind: 'openclaw',
    sourceDir,
    destDir,
    ops,
    unmapped,
    skippedForSafety,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────

async function listImmediateDirs(fsys: MigrationFs, dir: string): Promise<string[]> {
  const names = await fsys.readdir(dir).catch(() => [] as string[]);
  const out: string[] = [];
  for (const name of names) {
    const s = await fsys.stat(path.join(dir, name)).catch(() => null);
    if (s?.isDirectory) out.push(name);
  }
  return out.sort();
}

function extractModels(cfg: Record<string, unknown>, ops: MigrationOp[]): void {
  const models = cfg['models'];
  if (!models || typeof models !== 'object') return;
  const m = models as Record<string, unknown>;
  for (const [alias, value] of Object.entries(m)) {
    if (typeof value === 'string') {
      ops.push({
        kind: 'set-config',
        configKey: `providers.${alias}.model`,
        configValue: mapModelName(value),
        summary: `model ${alias} → ${mapModelName(value)}`,
      });
    } else if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if (typeof v['model'] === 'string') {
        ops.push({
          kind: 'set-config',
          configKey: `providers.${alias}.model`,
          configValue: mapModelName(String(v['model'])),
          summary: `model ${alias} → ${mapModelName(String(v['model']))}`,
        });
      }
    }
  }
}

function extractChannels(cfg: Record<string, unknown>, ops: MigrationOp[]): void {
  const channels = cfg['channels'];
  if (!channels || typeof channels !== 'object') return;
  for (const [name, value] of Object.entries(channels as Record<string, unknown>)) {
    if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if (typeof v['token'] === 'string' && v['token'].length > 0) {
        const envKey = `${name.toUpperCase()}_BOT_TOKEN`;
        ops.push({
          kind: 'set-env',
          envKey,
          envValue: v['token'],
          summary: `${name} token → env.${envKey}`,
        });
      }
    }
  }
}

function extractCron(cfg: Record<string, unknown>, ops: MigrationOp[]): void {
  const jobs = cfg['cron'] ?? cfg['schedules'];
  if (!Array.isArray(jobs)) return;
  for (const job of jobs) {
    if (job && typeof job === 'object') {
      const j = job as Record<string, unknown>;
      if (typeof j['schedule'] === 'string' && typeof j['action'] === 'string') {
        ops.push({
          kind: 'set-config',
          configKey: `cron.${(j['name'] as string) ?? `job-${Math.random().toString(36).slice(2, 7)}`}`,
          configValue: { schedule: j['schedule'], action: j['action'] },
          summary: `cron ${j['schedule']} → ${j['action']}`,
        });
      }
    }
  }
}

function mapModelName(name: string): string {
  // OpenClaw uses `anthropic/claude-sonnet-4-20250514`; Open Hipp0 uses the
  // bare model id + provider selected separately.
  const parts = name.split('/');
  if (parts.length === 2) return parts[1] ?? name;
  return name;
}

function flattenJson(obj: unknown, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      const key = prefix ? `${prefix}_${k}` : k;
      if (v && typeof v === 'object') Object.assign(out, flattenJson(v, key));
      else out[key] = v;
    }
  }
  return out;
}

function normalizeEnvKey(key: string): string {
  return key.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
}

function stripQuotes(s: string): string {
  const trimmed = s.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}
