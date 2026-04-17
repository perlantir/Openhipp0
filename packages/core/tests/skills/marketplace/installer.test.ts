import { describe, expect, it } from 'vitest';
import {
  computeBundleHash,
  install,
  pin,
  unpin,
  uninstall,
  listInstalled,
  rollback,
  type InstallerFs,
} from '../../../src/skills/marketplace/installer.js';
import { Hipp0MarketplaceError, type SkillBundle } from '../../../src/skills/marketplace/types.js';

function makeMemoryFs(): InstallerFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async readFile(p, e) {
      if (e !== 'utf8') throw new Error('only utf8 supported');
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    async writeFile(p, d) {
      files.set(p, d);
    },
    async mkdir() {
      /* no-op: memory fs is path-only */
    },
    async rm(p) {
      for (const k of [...files.keys()]) {
        if (k === p || k.startsWith(`${p}/`)) files.delete(k);
      }
    },
    async rename(from, to) {
      const v = files.get(from);
      if (v === undefined) throw new Error(`ENOENT: ${from}`);
      files.set(to, v);
      files.delete(from);
    },
    async stat(p) {
      const isDir = [...files.keys()].some((k) => k.startsWith(`${p}/`));
      return { isDirectory: () => isDir };
    },
  };
}

function mkBundle(overrides: Partial<SkillBundle['manifest']> = {}, extras: Partial<SkillBundle> = {}): SkillBundle {
  const manifest = {
    name: 'test-skill',
    description: 'a skill',
    version: '1.0.0',
    tools: [],
    dependencies: [],
    tags: [],
    ...overrides,
  };
  const skillMd = extras.skillMd ?? '# Test skill';
  const toolsSource = extras.toolsSource ?? undefined;
  const partial = {
    manifest,
    skillMd,
    publishedAt: '2026-04-16',
    publisher: 'me',
    ...(toolsSource !== undefined && { toolsSource }),
  };
  return { ...partial, contentHash: computeBundleHash(partial as never) } as SkillBundle;
}

describe('install', () => {
  it('writes manifest + SKILL.md + tools.ts to disk + records a ledger entry', async () => {
    const fs = makeMemoryFs();
    const bundle = mkBundle({}, { toolsSource: 'export const tools = [];' });
    const record = await install(bundle, {
      root: '/root',
      fs,
      now: () => '2026-04-16T10:00:00Z',
    });
    expect(fs.files.get('/root/test-skill/manifest.json')).toMatch(/test-skill/);
    expect(fs.files.get('/root/test-skill/SKILL.md')).toBe('# Test skill');
    expect(fs.files.get('/root/test-skill/tools.ts')).toContain('export const tools');
    expect(record.contentHash).toBe(bundle.contentHash);
    expect(JSON.parse(fs.files.get('/root/installed.json')!)).toHaveLength(1);
  });

  it('refuses to install over a pinned skill', async () => {
    const fs = makeMemoryFs();
    const b1 = mkBundle({ version: '1.0.0' });
    await install(b1, { root: '/root', fs, now: () => 't1' });
    await pin('test-skill', '1.0.0', { root: '/root', fs });
    const b2 = mkBundle({ version: '2.0.0' });
    await expect(install(b2, { root: '/root', fs, now: () => 't2' })).rejects.toThrow(/pinned/);
  });

  it('detects contentHash mismatch', async () => {
    const fs = makeMemoryFs();
    const b = mkBundle();
    const tampered = { ...b, skillMd: 'TAMPERED' };
    await expect(install(tampered as SkillBundle, { root: '/root', fs })).rejects.toBeInstanceOf(
      Hipp0MarketplaceError,
    );
  });

  it('records previousContentHash + previousVersion on upgrade', async () => {
    const fs = makeMemoryFs();
    const b1 = mkBundle({ version: '1.0.0' });
    await install(b1, { root: '/root', fs, now: () => 't1' });
    const b2 = mkBundle({ version: '2.0.0' });
    const rec = await install(b2, { root: '/root', fs, now: () => 't2' });
    expect(rec.previousContentHash).toBe(b1.contentHash);
    expect(rec.previousVersion).toBe('1.0.0');
    expect(rec.version).toBe('2.0.0');
  });
});

describe('pin / unpin', () => {
  it('pin sets pinnedVersion; unpin clears it', async () => {
    const fs = makeMemoryFs();
    const b = mkBundle();
    await install(b, { root: '/root', fs, now: () => 't' });
    const pinned = await pin('test-skill', '1.0.0', { root: '/root', fs });
    expect(pinned.pinnedVersion).toBe('1.0.0');
    const unpinned = await unpin('test-skill', { root: '/root', fs });
    expect(unpinned.pinnedVersion).toBeNull();
  });

  it('pin fails when skill is not installed', async () => {
    const fs = makeMemoryFs();
    await expect(pin('missing', '1.0.0', { root: '/root', fs })).rejects.toThrow(/not installed/);
  });
});

describe('uninstall', () => {
  it('removes files + ledger entry', async () => {
    const fs = makeMemoryFs();
    const b = mkBundle();
    await install(b, { root: '/root', fs, now: () => 't' });
    await uninstall('test-skill', { root: '/root', fs });
    const records = await listInstalled({ root: '/root', fs });
    expect(records).toHaveLength(0);
    expect([...fs.files.keys()].some((k) => k.startsWith('/root/test-skill/'))).toBe(false);
  });
});

describe('rollback', () => {
  it('reinstalls previous bundle when hash matches recorded previousContentHash', async () => {
    const fs = makeMemoryFs();
    const v1 = mkBundle({ version: '1.0.0' });
    const v2 = mkBundle({ version: '2.0.0' });
    await install(v1, { root: '/root', fs, now: () => 't1' });
    await install(v2, { root: '/root', fs, now: () => 't2' });
    const rolled = await rollback('test-skill', v1, { root: '/root', fs, now: () => 't3' });
    expect(rolled.version).toBe('1.0.0');
  });

  it('refuses when contentHash does not match recorded previousContentHash', async () => {
    const fs = makeMemoryFs();
    const v1 = mkBundle({ version: '1.0.0' });
    const v2 = mkBundle({ version: '2.0.0' });
    const otherV1 = mkBundle({ version: '1.0.0', name: 'different' });
    await install(v1, { root: '/root', fs, now: () => 't1' });
    await install(v2, { root: '/root', fs, now: () => 't2' });
    await expect(
      rollback('test-skill', otherV1, { root: '/root', fs, now: () => 't3' }),
    ).rejects.toThrow(/ROLLBACK_MISMATCH|does not match/);
  });
});

describe('listInstalled', () => {
  it('returns empty before any install', async () => {
    const fs = makeMemoryFs();
    expect(await listInstalled({ root: '/root', fs })).toEqual([]);
  });
});
