import { describe, expect, it } from 'vitest';
import {
  createBackup,
  restoreBackup,
  createLocalBackend,
  createS3Backend,
  encryptJson,
  decryptJson,
  buildManifest,
  verifyManifest,
  checksumDataset,
  type DataSink,
  type DataSource,
  type S3Client,
  Hipp0BackupError,
} from '../../src/backup/index.js';

function makeMemoryFs() {
  const files = new Map<string, string>();
  return {
    files,
    async readFile(p: string, _e: 'utf8') {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT: ${p}`);
      return v;
    },
    async writeFile(p: string, d: string) { files.set(p, d); },
    async mkdir() {},
    async rm(p: string) { files.delete(p); },
    async readdir(p: string) {
      return [...files.keys()]
        .filter((k) => k.startsWith(`${p}/`))
        .map((k) => k.slice(p.length + 1));
    },
  };
}

function mkSource(rows: Record<string, unknown[]>): DataSource {
  return {
    async tables() { return Object.keys(rows); },
    async fetch(t) { return rows[t] ?? []; },
    async schemaVersion() { return '1.0'; },
    async instanceId() { return 'inst-1'; },
  };
}

describe('encrypt/decrypt', () => {
  it('roundtrips JSON under the same password', () => {
    const blob = encryptJson({ hello: 'world', n: 42 }, 's3cret');
    const back = decryptJson<{ hello: string; n: number }>(blob, 's3cret');
    expect(back.hello).toBe('world');
    expect(back.n).toBe(42);
  });

  it('decrypt fails with wrong password', () => {
    const blob = encryptJson({ x: 1 }, 'right');
    expect(() => decryptJson(blob, 'wrong')).toThrow(Hipp0BackupError);
  });

  it('unique nonces mean same plaintext produces different ciphertext', () => {
    const a = encryptJson({ x: 1 }, 'p');
    const b = encryptJson({ x: 1 }, 'p');
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.nonce).not.toBe(b.nonce);
  });
});

describe('manifest', () => {
  it('checksumDataset is deterministic and order-independent at key level', () => {
    const a = checksumDataset([{ id: 1, name: 'a' }, { id: 2, name: 'b' }]);
    const b = checksumDataset([{ name: 'a', id: 1 }, { name: 'b', id: 2 }]);
    expect(a).toBe(b);
  });

  it('verifyManifest passes on a fresh build', () => {
    const m = buildManifest({
      instanceId: 'i',
      schemaVersion: '1',
      tables: [{ name: 't', rowCount: 0, checksum: 'c', encryptedBytes: 0 }],
      now: () => '2026-04-16T00:00:00Z',
    });
    expect(() => verifyManifest(m)).not.toThrow();
  });

  it('verifyManifest rejects a tampered overallChecksum', () => {
    const m = buildManifest({
      instanceId: 'i',
      schemaVersion: '1',
      tables: [{ name: 't', rowCount: 0, checksum: 'c', encryptedBytes: 0 }],
      now: () => '2026-04-16T00:00:00Z',
    });
    const tampered = { ...m, overallChecksum: 'XXX' };
    expect(() => verifyManifest(tampered)).toThrow(/tampered/);
  });
});

describe('createBackup + restoreBackup (local backend)', () => {
  it('creates, reads back, and roundtrips through sink', async () => {
    const fs = makeMemoryFs();
    const backend = createLocalBackend({ root: '/backups', fs });
    const source = mkSource({
      decisions: [{ id: 'd1', title: 't1' }, { id: 'd2', title: 't2' }],
      memory: [{ id: 'm1', content: 'hi' }],
    });
    const { key, manifest } = await createBackup({
      source,
      password: 'p',
      backend,
      now: () => '2026-04-16T10-00-00Z',
    });
    expect(manifest.tables).toHaveLength(2);
    expect(manifest.overallChecksum).toHaveLength(64);

    const captured: Record<string, readonly unknown[]> = {};
    const sink: DataSink = {
      async apply(table, rows) { captured[table] = rows; },
    };
    await restoreBackup({ sink, password: 'p', backend, key });
    expect(captured.decisions).toHaveLength(2);
    expect(captured.memory).toHaveLength(1);
  });

  it('restore throws on wrong password', async () => {
    const fs = makeMemoryFs();
    const backend = createLocalBackend({ root: '/backups', fs });
    const source = mkSource({ t: [{ id: 1 }] });
    const { key } = await createBackup({ source, password: 'right', backend });
    const sink: DataSink = { async apply() {} };
    await expect(
      restoreBackup({ sink, password: 'wrong', backend, key }),
    ).rejects.toBeInstanceOf(Hipp0BackupError);
  });

  it('restore throws on missing backup', async () => {
    const fs = makeMemoryFs();
    const backend = createLocalBackend({ root: '/backups', fs });
    const sink: DataSink = { async apply() {} };
    await expect(
      restoreBackup({ sink, password: 'p', backend, key: 'nope.json' }),
    ).rejects.toThrow(/not found/);
  });

  it('detects blob tampering via checksum mismatch', async () => {
    const fs = makeMemoryFs();
    const backend = createLocalBackend({ root: '/backups', fs });
    const source = mkSource({ t: [{ id: 1 }] });
    const { key } = await createBackup({ source, password: 'p', backend });
    // Corrupt the stored artifact.
    const raw = fs.files.get(`/backups/${key}`)!;
    const parsed = JSON.parse(raw);
    parsed.blobs.t.ciphertext = Buffer.from('garbage').toString('base64');
    fs.files.set(`/backups/${key}`, JSON.stringify(parsed));
    const sink: DataSink = { async apply() {} };
    await expect(
      restoreBackup({ sink, password: 'p', backend, key }),
    ).rejects.toBeInstanceOf(Hipp0BackupError);
  });
});

describe('S3 backend', () => {
  it('put / get / list / delete against a fake client', async () => {
    const store = new Map<string, string>();
    const client: S3Client = {
      async putObject({ Key, Body }) { store.set(Key, Body); },
      async getObject({ Key }) {
        const v = store.get(Key);
        return v !== undefined ? { Body: v } : null;
      },
      async listObjects({ Prefix }) {
        const keys = [...store.keys()].filter((k) => !Prefix || k.startsWith(Prefix));
        return { Keys: keys };
      },
      async deleteObject({ Key }) { store.delete(Key); },
    };
    const backend = createS3Backend({ bucket: 'bk', client, prefix: 'hipp0' });
    const source = mkSource({ t: [{ id: 1 }] });
    const { key } = await createBackup({ source, password: 'p', backend });
    expect(await backend.list()).toEqual([`hipp0/${key}`]);
    const sink: DataSink = { async apply() {} };
    await restoreBackup({ sink, password: 'p', backend, key });
    await backend.delete(key);
    expect(await backend.list()).toEqual([]);
  });
});
