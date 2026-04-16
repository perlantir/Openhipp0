import { beforeEach, describe, expect, it } from 'vitest';
import { generateKeyPairSync, sign } from 'node:crypto';
import {
  McpMarketplaceInstaller,
  type InstallerAuditEvent,
  type InstallerFs,
} from '../../src/mcp-marketplace/installer.js';
import {
  canonicalBundleBytes,
  computeBundleHash,
} from '../../src/mcp-marketplace/hash.js';
import type { McpServerBundle } from '../../src/mcp-marketplace/types.js';

function inMemoryFs(): InstallerFs {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  return {
    async readFile(path) {
      const f = files.get(path);
      if (f === undefined) throw new Error(`ENOENT: ${path}`);
      return f;
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
    async mkdir(path) {
      dirs.add(path);
    },
    async rm(path) {
      for (const k of [...files.keys()]) {
        if (k === path || k.startsWith(path + '/')) files.delete(k);
      }
      dirs.delete(path);
    },
    async exists(path) {
      return files.has(path) || dirs.has(path);
    },
  };
}

function keyPair(): {
  publicKeyB64: string;
  privatePem: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicSpki = publicKey.export({ type: 'spki', format: 'pem' }) as string;
  const pubBody = publicSpki
    .replace(/-----BEGIN PUBLIC KEY-----/g, '')
    .replace(/-----END PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '');
  return {
    publicKeyB64: pubBody,
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
  };
}

function makeBundle(overrides: Partial<McpServerBundle> = {}): McpServerBundle {
  const base: Omit<McpServerBundle, 'contentHash'> = {
    name: overrides.name ?? 'test-server',
    version: overrides.version ?? '1.0.0',
    command: overrides.command ?? { cmd: 'node', args: ['server.js'], env: {} },
    posture: overrides.posture ?? {
      tools: ['list_files', 'get_metadata'],
      networkAllowlist: ['localhost'],
      fsPaths: ['/tmp/test'],
      envVarsRead: [],
      description: 'test mcp server',
    },
    publishedAt: '2026-04-01',
    ...(overrides.signature && { signature: overrides.signature }),
  };
  const contentHash = computeBundleHash(base);
  return { ...base, contentHash };
}

function signBundle(bundle: McpServerBundle, keys: ReturnType<typeof keyPair>): McpServerBundle {
  const message = Buffer.from(bundle.contentHash, 'hex');
  const signature = sign(null, message, keys.privatePem);
  return {
    ...bundle,
    signature: {
      algorithm: 'ed25519',
      publicKey: keys.publicKeyB64,
      signature: signature.toString('base64'),
      signer: 'test-publisher',
    },
  };
}

describe('McpMarketplaceInstaller', () => {
  let fs: InstallerFs;
  let installer: McpMarketplaceInstaller;
  let audits: InstallerAuditEvent[];

  beforeEach(() => {
    fs = inMemoryFs();
    audits = [];
    installer = new McpMarketplaceInstaller({
      fs,
      rootDir: '/root/.hipp0/mcp-servers',
      requireSignature: false,
      onAudit: (e) => {
        audits.push(e);
      },
    });
  });

  it('install records the bundle + ledger entry + audit event', async () => {
    const bundle = makeBundle();
    const record = await installer.install(bundle);
    expect(record.name).toBe('test-server');
    expect(record.contentHash).toBe(bundle.contentHash);
    const ledger = await installer.list();
    expect(ledger.installed).toHaveLength(1);
    const storedBundle = await installer.getBundle('test-server');
    expect(storedBundle?.contentHash).toBe(bundle.contentHash);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.kind).toBe('install');
  });

  it('rejects a bundle whose contentHash is tampered', async () => {
    const bundle = makeBundle();
    const tampered = { ...bundle, contentHash: 'a'.repeat(64) };
    await expect(installer.install(tampered)).rejects.toThrow(/contentHash mismatch/);
  });

  it('blocks unsigned install when requireSignature=true', async () => {
    const strict = new McpMarketplaceInstaller({
      fs,
      rootDir: '/root/.hipp0/mcp-servers',
      requireSignature: true,
    });
    await expect(strict.install(makeBundle())).rejects.toThrow(/signature invalid/);
  });

  it('accepts signed install when requireSignature=true', async () => {
    const keys = keyPair();
    const bundle = signBundle(makeBundle(), keys);
    const strict = new McpMarketplaceInstaller({
      fs,
      rootDir: '/root/.hipp0/mcp-servers',
      requireSignature: true,
    });
    const record = await strict.install(bundle);
    expect(record.signer).toBe('test-publisher');
  });

  it('rejects install with tool-name collision vs already-installed server', async () => {
    await installer.install(makeBundle({ name: 'first', posture: {
      tools: ['shared_tool', 'a'],
      networkAllowlist: ['localhost'],
      fsPaths: [],
      envVarsRead: [],
      description: '',
    } }));
    const other = makeBundle({ name: 'second', posture: {
      tools: ['shared_tool', 'b'],
      networkAllowlist: ['localhost'],
      fsPaths: [],
      envVarsRead: [],
      description: '',
    } });
    await expect(installer.install(other)).rejects.toThrow(/already claimed/);
  });

  it('respects maxInstalledPerProject cap', async () => {
    const capped = new McpMarketplaceInstaller({
      fs,
      rootDir: '/root/.hipp0/mcp-servers',
      requireSignature: false,
      maxInstalledPerProject: 2,
    });
    await capped.install(makeBundle({ name: 'a', posture: { tools: ['a_tool'], networkAllowlist: [], fsPaths: [], envVarsRead: [], description: '' } }));
    await capped.install(makeBundle({ name: 'b', posture: { tools: ['b_tool'], networkAllowlist: [], fsPaths: [], envVarsRead: [], description: '' } }));
    await expect(
      capped.install(makeBundle({ name: 'c', posture: { tools: ['c_tool'], networkAllowlist: [], fsPaths: [], envVarsRead: [], description: '' } })),
    ).rejects.toThrow(/cap reached/);
  });

  it('pin + unpin flips the record flag', async () => {
    await installer.install(makeBundle());
    const pinned = await installer.pin('test-server');
    expect(pinned?.pinned).toBe(true);
    const unpinned = await installer.unpin('test-server');
    expect(unpinned?.pinned).toBe(false);
  });

  it('rollback requires the correct previous bundle hash', async () => {
    const v1 = makeBundle({ version: '1.0.0' });
    await installer.install(v1);
    const v2 = makeBundle({
      version: '2.0.0',
      posture: {
        tools: ['list_files', 'get_metadata', 'new_tool'],
        networkAllowlist: ['localhost'],
        fsPaths: ['/tmp/test'],
        envVarsRead: [],
        description: 'test mcp server',
      },
    });
    await installer.install(v2);
    // Rollback with wrong hash rejects.
    const wrong = makeBundle({ version: '9.9.9' });
    await expect(installer.rollback('test-server', wrong)).rejects.toThrow(/hash mismatch/);
    // Rollback with correct previous bundle succeeds.
    const restored = await installer.rollback('test-server', v1);
    expect(restored?.contentHash).toBe(v1.contentHash);
  });

  it('uninstall removes the ledger entry + bundle file + audit', async () => {
    await installer.install(makeBundle());
    const removed = await installer.uninstall('test-server');
    expect(removed).toBe(true);
    const ledger = await installer.list();
    expect(ledger.installed).toHaveLength(0);
    expect(audits.find((e) => e.kind === 'uninstall')).toBeDefined();
  });

  it('previewInstall returns a posture diff BEFORE commit', async () => {
    await installer.install(makeBundle({ version: '1.0.0' }));
    const v2 = makeBundle({
      version: '2.0.0',
      posture: {
        tools: ['list_files', 'get_metadata', 'run_query'],
        networkAllowlist: ['localhost', 'api.example.com'],
        fsPaths: ['/tmp/test', '/var/data'],
        envVarsRead: ['DB_HOST'],
        description: 'upgraded',
      },
    });
    const { diff, existing } = await installer.previewInstall(v2);
    expect(existing?.name).toBe('test-server');
    expect(diff.toolsAdded).toEqual(['run_query']);
    expect(diff.networkAdded).toEqual(['api.example.com']);
    expect(diff.fsPathsAdded).toEqual(['/var/data']);
    expect(diff.envVarsAdded).toEqual(['DB_HOST']);
  });
});

describe('canonicalBundleBytes', () => {
  it('produces a stable serialization regardless of input key order', () => {
    const a = canonicalBundleBytes({
      name: 'x',
      version: '1',
      command: { cmd: 'node', args: ['a', 'b'], env: { B: '1', A: '2' } },
      posture: {
        tools: ['z', 'a'],
        networkAllowlist: ['b', 'a'],
        fsPaths: [],
        envVarsRead: [],
        description: '',
      },
    });
    const b = canonicalBundleBytes({
      posture: {
        envVarsRead: [],
        description: '',
        fsPaths: [],
        networkAllowlist: ['a', 'b'],
        tools: ['a', 'z'],
      },
      command: { env: { A: '2', B: '1' }, args: ['a', 'b'], cmd: 'node' },
      version: '1',
      name: 'x',
    });
    expect(a).toBe(b);
  });
});
