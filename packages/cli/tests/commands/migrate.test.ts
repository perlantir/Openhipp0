import { describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import type { MigrationFs } from '../../src/commands/migrate-shared.js';
import { parseMemoryEntries } from '../../src/commands/migrate-shared.js';
import { runMigrateOpenClaw } from '../../src/commands/migrate-openclaw.js';
import { runMigrateHermes } from '../../src/commands/migrate-hermes.js';

function createMemoryMigrationFs(seed: Record<string, string | Uint8Array> = {}): MigrationFs & {
  store: Map<string, string | Uint8Array>;
} {
  const store = new Map<string, string | Uint8Array>(Object.entries(seed));
  const dirs = new Set<string>();
  for (const key of store.keys()) {
    let p = path.dirname(key);
    while (p && p !== '/' && p !== '.') {
      dirs.add(p);
      p = path.dirname(p);
    }
  }
  const now = new Date('2026-04-16T00:00:00Z');
  return {
    store,
    now: () => now,
    async exists(p: string) {
      return store.has(p) || dirs.has(p);
    },
    async readFile(p: string) {
      const v = store.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return typeof v === 'string' ? v : Buffer.from(v).toString('utf8');
    },
    async readBinaryFile(p: string) {
      const v = store.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return typeof v === 'string' ? new TextEncoder().encode(v) : v;
    },
    async writeFile(p: string, content: string | Uint8Array) {
      store.set(p, content);
      let cur = path.dirname(p);
      while (cur && cur !== '/' && cur !== '.') {
        dirs.add(cur);
        cur = path.dirname(cur);
      }
    },
    async mkdir(p: string) {
      dirs.add(p);
      let cur = path.dirname(p);
      while (cur && cur !== '/' && cur !== '.') {
        dirs.add(cur);
        cur = path.dirname(cur);
      }
    },
    async readdir(p: string) {
      const children = new Set<string>();
      const prefix = p.endsWith('/') ? p : `${p}/`;
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          const rest = key.slice(prefix.length);
          const first = rest.split('/')[0]!;
          children.add(first);
        }
      }
      for (const d of dirs) {
        if (d.startsWith(prefix)) {
          const rest = d.slice(prefix.length);
          const first = rest.split('/')[0]!;
          if (first) children.add(first);
        }
      }
      return [...children];
    },
    async stat(p: string) {
      if (store.has(p)) {
        const v = store.get(p)!;
        return { isDirectory: false, size: typeof v === 'string' ? v.length : v.length };
      }
      if (dirs.has(p)) return { isDirectory: true, size: 0 };
      throw new Error(`ENOENT ${p}`);
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────

describe('parseMemoryEntries', () => {
  it('splits on "## " headings', () => {
    const text = '## First\ndetail one\n\n## Second\ndetail two';
    const entries = parseMemoryEntries(text);
    expect(entries.length).toBe(2);
    expect(entries[0]!.startsWith('## First')).toBe(true);
  });

  it('falls back to paragraph split', () => {
    const text = 'one thing\n\ntwo thing\n\nthree thing';
    const entries = parseMemoryEntries(text);
    expect(entries).toEqual(['one thing', 'two thing', 'three thing']);
  });

  it('returns empty for empty input', () => {
    expect(parseMemoryEntries('')).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────────

describe('runMigrateOpenClaw', () => {
  it('produces a plan preview in dry-run and does not write destination files', async () => {
    const fsys = createMemoryMigrationFs({
      '/src/SOUL.md': 'I am an agent.',
      '/src/IDENTITY.md': 'agent id',
      '/src/MEMORY.md': '## one\nfact one\n\n## two\nfact two',
      '/src/skills/demo/SKILL.md': '# Demo\n',
      '/src/skills/demo/manifest.json': '{}',
      '/src/openclaw.json': JSON.stringify({
        models: { default: 'anthropic/claude-sonnet-4-20250514' },
        channels: { telegram: { token: 'telegram-secret-123' } },
      }),
    });
    const ingested: Array<readonly string[]> = [];
    const envSet: Array<[string, string]> = [];
    const configSet: Array<[string, unknown]> = [];
    const result = await runMigrateOpenClaw({
      source: '/src',
      destDir: '/dest',
      dryRun: true,
      preset: 'full',
      fs: fsys,
      onIngestMemory: async (entries) => {
        ingested.push(entries);
      },
      onSetEnv: async (k, v) => {
        envSet.push([k, v]);
      },
      onSetConfig: async (k, v) => {
        configSet.push([k, v]);
      },
    });
    expect(result.exitCode).toBe(0);
    expect(result.report!.plan.ops.length).toBeGreaterThan(0);
    expect(result.report!.dryRun).toBe(true);
    // Dry-run should NOT call ingest callbacks.
    expect(ingested.length).toBe(0);
    // And nothing should be written to /dest.
    expect(await fsys.exists('/dest/soul.md')).toBe(false);
    // Plan should include an ingest-memory op for the 2 entries.
    const ingestOps = result.report!.plan.ops.filter((o) => o.kind === 'ingest-memory');
    expect(ingestOps[0]!.memoryEntries!.length).toBe(2);
    // Channel token mapped to env.
    const telegramEnv = result.report!.plan.ops.find(
      (o) => o.kind === 'set-env' && o.envKey === 'TELEGRAM_BOT_TOKEN',
    );
    expect(telegramEnv?.envValue).toBe('telegram-secret-123');
    // Model normalized (strip "anthropic/" prefix).
    const modelCfg = result.report!.plan.ops.find(
      (o) => o.kind === 'set-config' && o.configKey === 'providers.default.model',
    );
    expect(modelCfg?.configValue).toBe('claude-sonnet-4-20250514');
  });

  it('executes non-destructively and triggers ingest callbacks when not dry-run', async () => {
    const fsys = createMemoryMigrationFs({
      '/src/SOUL.md': 'persona',
      '/src/MEMORY.md': 'entry one\n\nentry two',
    });
    const ingested: Array<readonly string[]> = [];
    const result = await runMigrateOpenClaw({
      source: '/src',
      destDir: '/dest',
      dryRun: false,
      preset: 'user-data',
      fs: fsys,
      onIngestMemory: async (entries) => {
        ingested.push(entries);
      },
    });
    expect(result.exitCode).toBe(0);
    expect(await fsys.exists('/dest/soul.md')).toBe(true);
    expect(await fsys.readFile('/dest/soul.md')).toBe('persona');
    // Source untouched.
    expect(await fsys.readFile('/src/SOUL.md')).toBe('persona');
    // Ingest called.
    expect(ingested.length).toBeGreaterThan(0);
    expect(result.report!.memoryEntriesIngested).toBe(2);
  });

  it('is idempotent — running twice produces identical destination', async () => {
    const fsys = createMemoryMigrationFs({
      '/src/SOUL.md': 'persona',
      '/src/IDENTITY.md': 'id',
    });
    await runMigrateOpenClaw({ source: '/src', destDir: '/dest', dryRun: false, fs: fsys, preset: 'user-data' });
    const soulAfter1 = await fsys.readFile('/dest/soul.md');
    await runMigrateOpenClaw({ source: '/src', destDir: '/dest', dryRun: false, fs: fsys, preset: 'user-data' });
    const soulAfter2 = await fsys.readFile('/dest/soul.md');
    expect(soulAfter1).toBe(soulAfter2);
  });

  it('preset=user-data skips set-env and set-config ops', async () => {
    const fsys = createMemoryMigrationFs({
      '/src/openclaw.json': JSON.stringify({
        channels: { telegram: { token: 'abc' } },
      }),
    });
    const envSet: string[] = [];
    const result = await runMigrateOpenClaw({
      source: '/src',
      destDir: '/dest',
      dryRun: false,
      preset: 'user-data',
      fs: fsys,
      onSetEnv: async (k) => {
        envSet.push(k);
      },
    });
    expect(envSet).toHaveLength(0);
    expect(result.report!.skipped).toBeGreaterThan(0);
  });

  it('throws when the source directory is missing', async () => {
    const fsys = createMemoryMigrationFs({});
    await expect(
      runMigrateOpenClaw({ source: '/does-not-exist', fs: fsys }),
    ).rejects.toThrow(/No source directory|does not exist/);
  });
});

// ──────────────────────────────────────────────────────────────────────────

describe('runMigrateHermes', () => {
  it('copies skills verbatim (already agentskills.io format)', async () => {
    const fsys = createMemoryMigrationFs({
      '/h/SOUL.md': 'hermes persona',
      '/h/skills/search/SKILL.md': '# search skill',
      '/h/skills/search/manifest.json': '{"name":"search"}',
      '/h/config.yaml': 'models:\n  default: claude-sonnet-4\n',
      '/h/auth.json': JSON.stringify({ anthropic: { api_key: 'sk-ant' } }),
    });
    const configSet: Array<[string, unknown]> = [];
    const envSet: Array<[string, string]> = [];
    const result = await runMigrateHermes({
      source: '/h',
      destDir: '/dest',
      preset: 'full',
      dryRun: false,
      fs: fsys,
      onSetConfig: async (k, v) => {
        configSet.push([k, v]);
      },
      onSetEnv: async (k, v) => {
        envSet.push([k, v]);
      },
    });
    expect(result.exitCode).toBe(0);
    // Skills copied
    expect(await fsys.exists('/dest/skills/hermes-imports/search/SKILL.md')).toBe(true);
    expect(await fsys.readFile('/dest/skills/hermes-imports/search/SKILL.md')).toBe('# search skill');
    // Config extracted
    expect(configSet.some(([k]) => k === 'models.default')).toBe(true);
    // Env extracted from auth.json
    expect(envSet.some(([k]) => k === 'ANTHROPIC_API_KEY')).toBe(true);
  });
});
