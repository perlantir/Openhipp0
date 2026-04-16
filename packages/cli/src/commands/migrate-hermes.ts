/**
 * `hipp0 migrate hermes` — Hermes Agent → Open Hipp0.
 *
 * Hermes already uses the agentskills.io skill format, so skill dirs are a
 * direct copy. Session history lives in a SQLite file; we surface it as a
 * memory-ingest op so the destination store picks it up during re-embed.
 */

import path from 'node:path';
import { homedir } from 'node:os';
import type { CommandResult } from '../types.js';
import {
  detectHermesSource,
  parseMemoryEntries,
  runMigrateCommon,
  walkDir,
  type MigrationFs,
  type MigrationOp,
  type MigrationPlan,
  type MigrationReport,
} from './migrate-shared.js';

export interface MigrateHermesOptions {
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

export async function runMigrateHermes(
  opts: MigrateHermesOptions = {},
): Promise<CommandResult & { report?: MigrationReport }> {
  return runMigrateCommon({
    autoDetect: detectHermesSource,
    buildPlan: (src) => buildHermesPlan(src, opts.destDir, opts.fs),
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

async function buildHermesPlan(
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

  // SOUL.md → soul.md
  const soul = path.join(sourceDir, 'SOUL.md');
  if (await fsys.exists(soul)) {
    ops.push({
      kind: 'rewrite',
      source: soul,
      dest: path.join(destDir, 'soul.md'),
      summary: 'persona → soul.md',
    });
  }

  // MEMORY.md
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
    ops.push({
      kind: 'rewrite',
      source: mem,
      dest: path.join(destDir, 'archive', 'hermes-MEMORY.md'),
      summary: 'archive original MEMORY.md',
    });
  }

  // skills/ — direct copy (already agentskills.io format).
  const skills = path.join(sourceDir, 'skills');
  if (await fsys.exists(skills)) {
    const files = await walkDir(fsys, skills);
    for (const rel of files) {
      ops.push({
        kind: 'copy',
        source: path.join(skills, rel),
        dest: path.join(destDir, 'skills', 'hermes-imports', rel),
        summary: `skill ${rel}`,
      });
    }
  }

  // config.yaml — parse loosely; we only look for a few known keys.
  const cfgPath = path.join(sourceDir, 'config.yaml');
  if (await fsys.exists(cfgPath)) {
    const text = await fsys.readFile(cfgPath);
    extractHermesConfig(text, ops);
    ops.push({
      kind: 'rewrite',
      source: cfgPath,
      dest: path.join(destDir, 'archive', 'hermes-config.yaml'),
      summary: 'archive config.yaml',
    });
  }

  // auth.json — nested provider tokens.
  const auth = path.join(sourceDir, 'auth.json');
  if (await fsys.exists(auth)) {
    try {
      const raw = JSON.parse(await fsys.readFile(auth)) as Record<string, unknown>;
      for (const [provider, details] of Object.entries(raw)) {
        if (details && typeof details === 'object') {
          const d = details as Record<string, unknown>;
          for (const [k, v] of Object.entries(d)) {
            if (typeof v === 'string' && v.length > 0 && /key|token|secret/i.test(k)) {
              const envKey = `${provider.toUpperCase()}_${k.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}`;
              ops.push({
                kind: 'set-env',
                envKey,
                envValue: v,
                summary: `env: ${envKey}=…`,
              });
            }
          }
        }
      }
    } catch {
      unmapped.push('auth.json (invalid JSON)');
    }
  }

  // cron/jobs.json
  const cron = path.join(sourceDir, 'cron', 'jobs.json');
  if (await fsys.exists(cron)) {
    try {
      const jobs = JSON.parse(await fsys.readFile(cron)) as Array<Record<string, unknown>>;
      for (const job of jobs) {
        if (typeof job['schedule'] === 'string' && typeof job['action'] === 'string') {
          ops.push({
            kind: 'set-config',
            configKey: `cron.${(job['name'] as string) ?? `job-${ops.length}`}`,
            configValue: { schedule: job['schedule'], action: job['action'] },
            summary: `cron ${job['schedule']} → ${job['action']}`,
          });
        }
      }
    } catch {
      unmapped.push('cron/jobs.json');
    }
  }

  // Session history DB — just copy as a binary; the memory package can
  // open it and fold into sessionHistory on next startup.
  const sqlite = path.join(sourceDir, 'sessions.sqlite');
  if (await fsys.exists(sqlite)) {
    ops.push({
      kind: 'copy',
      source: sqlite,
      dest: path.join(destDir, 'import', 'hermes-sessions.sqlite'),
      summary: 'session history → import/hermes-sessions.sqlite',
    });
  }

  for (const safe of ['secrets', '.ssh', '.aws', '.gnupg']) {
    const p = path.join(sourceDir, safe);
    if (await fsys.exists(p)) skippedForSafety.push(safe);
  }

  return {
    kind: 'hermes',
    sourceDir,
    destDir,
    ops,
    unmapped,
    skippedForSafety,
  };
}

function extractHermesConfig(yaml: string, ops: MigrationOp[]): void {
  // Minimal YAML-ish extractor — supports `key: value` at top level +
  // one level of nesting (`models:\n  default: claude-sonnet-4`).
  const lines = yaml.split(/\r?\n/);
  let section: string | null = null;
  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trimEnd();
    if (!line) continue;
    if (/^[A-Za-z0-9_-]+:\s*$/.test(line)) {
      section = line.replace(/:\s*$/, '');
      continue;
    }
    const m = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!m) continue;
    const indent = m[1]?.length ?? 0;
    const key = m[2]!;
    const val = stripYamlValue(m[3] ?? '');
    if (indent === 0) {
      section = null;
      if (val) {
        ops.push({ kind: 'set-config', configKey: key, configValue: val, summary: `config ${key}=${val}` });
      }
    } else if (section && val) {
      ops.push({
        kind: 'set-config',
        configKey: `${section}.${key}`,
        configValue: val,
        summary: `config ${section}.${key}=${val}`,
      });
    }
  }
}

function stripYamlValue(v: string): string {
  const t = v.trim();
  if (!t) return '';
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}
