import { describe, expect, it } from 'vitest';
import { skills } from '@openhipp0/core';
import {
  runMarketplaceInstall,
  runMarketplaceList,
  runMarketplacePin,
  runMarketplaceSearch,
  runMarketplaceUninstall,
  runMarketplaceUnpin,
} from '../../src/commands/marketplace.js';
type InstallerFs = skills.marketplace.InstallerFs;

function makeMemoryFs(): InstallerFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async readFile(p, e) {
      if (e !== 'utf8') throw new Error('only utf8');
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    async writeFile(p, d) {
      files.set(p, d);
    },
    async mkdir() {},
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
    async stat() {
      return { isDirectory: () => true };
    },
  };
}

function makeClient(overrides: { listings?: unknown; listing?: unknown; bundle?: unknown } = {}) {
  const manifest = {
    name: 'demo',
    description: 'a demo skill',
    version: '1.0.0',
    tools: [],
    dependencies: [],
    tags: [],
  };
  const skillMd = '# demo';
  const partial = { manifest, skillMd, publishedAt: '2026-04-16', publisher: 'me' } as Parameters<
    typeof skills.marketplace.computeBundleHash
  >[0];
  const contentHash = skills.marketplace.computeBundleHash(partial);
  const defaultBundle = { ...partial, contentHash };
  const defaultListing = {
    name: 'demo',
    description: 'a demo skill',
    version: '1.0.0',
    publisher: 'me',
    tags: ['demo'],
    downloads: 10,
    rating: 4.2,
    ratingCount: 3,
    bundleUrl: 'https://cdn/bundles/demo.json',
    publishedAt: '2026-04-16',
  };
  const fakeFetch = async (url: string) => {
    if (url.endsWith('/listings') || url.includes('/listings?')) {
      return {
        ok: true,
        status: 200,
        async json() { return overrides.listings ?? { listings: [defaultListing] }; },
        async text() { return ''; },
      };
    }
    if (url.endsWith('/listings/demo')) {
      return {
        ok: true,
        status: 200,
        async json() { return overrides.listing ?? defaultListing; },
        async text() { return ''; },
      };
    }
    if (url.includes('/bundles/demo.json')) {
      return {
        ok: true,
        status: 200,
        async json() { return overrides.bundle ?? defaultBundle; },
        async text() { return ''; },
      };
    }
    return { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
  };
  return new skills.marketplace.MarketplaceClient({ indexUrl: 'https://ix/api/v1', fetchImpl: fakeFetch });
}

describe('runMarketplaceSearch', () => {
  it('renders results or empty message', async () => {
    const client = makeClient();
    const result = await runMarketplaceSearch(undefined, { client });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.join('\n')).toContain('demo@1.0.0');
    expect(result.stdout.join('\n')).toContain('★4.2');
  });

  it('handles empty result', async () => {
    const client = makeClient({ listings: { listings: [] } });
    const result = await runMarketplaceSearch('nothing', { client });
    expect(result.stdout[0]).toContain('No skills');
  });
});

describe('runMarketplaceInstall', () => {
  it('installs + reports', async () => {
    const fs = makeMemoryFs();
    const client = makeClient();
    const result = await runMarketplaceInstall('demo', {
      client,
      fs,
      root: '/root',
      now: () => '2026-04-16T10:00:00Z',
    });
    expect(result.stdout.join('\n')).toContain('Installed demo@1.0.0');
    expect(fs.files.has('/root/demo/manifest.json')).toBe(true);
  });
});

describe('pin + unpin + list + uninstall', () => {
  it('end-to-end flow', async () => {
    const fs = makeMemoryFs();
    const client = makeClient();
    await runMarketplaceInstall('demo', { client, fs, root: '/root', now: () => 't' });
    const pinRes = await runMarketplacePin('demo', '1.0.0', { fs, root: '/root' });
    expect(pinRes.stdout[0]).toContain('Pinned demo to 1.0.0');
    const listRes = await runMarketplaceList({ fs, root: '/root' });
    expect(listRes.stdout.join('\n')).toMatch(/pinned 1\.0\.0/);
    const unpinRes = await runMarketplaceUnpin('demo', { fs, root: '/root' });
    expect(unpinRes.stdout[0]).toContain('Unpinned');
    const uninstallRes = await runMarketplaceUninstall('demo', { fs, root: '/root' });
    expect(uninstallRes.stdout[0]).toContain('Uninstalled');
  });
});
