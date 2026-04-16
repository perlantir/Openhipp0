import { describe, expect, it } from 'vitest';
import { backup as backupModule } from '@openhipp0/core';
import {
  localBackend,
  runBackupCreate,
  runBackupList,
  runBackupRestore,
} from '../../src/commands/backup.js';

function memFs() {
  const files = new Map<string, string>();
  return {
    files,
    async readFile(p: string) {
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

function mkSource(): backupModule.DataSource {
  return {
    async tables() { return ['decisions', 'memory']; },
    async fetch(t) {
      if (t === 'decisions') return [{ id: 'd1', title: 't1' }];
      if (t === 'memory') return [{ id: 'm1', content: 'hi' }];
      return [];
    },
    async schemaVersion() { return '1.0'; },
    async instanceId() { return 'test-inst'; },
  };
}

describe('runBackupCreate', () => {
  it('creates a backup via the local backend', async () => {
    const fs = memFs();
    const backend = backupModule.createLocalBackend({ root: '/backups', fs });
    const result = await runBackupCreate({
      backend,
      password: 'p',
      source: mkSource(),
      now: () => '2026-04-16T10-00-00Z',
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout[0]).toMatch(/Backup written/);
    expect(fs.files.size).toBe(1);
  });

  it('throws when source is missing', async () => {
    const fs = memFs();
    const backend = backupModule.createLocalBackend({ root: '/backups', fs });
    await expect(runBackupCreate({ backend, password: 'p' })).rejects.toThrow(/DataSource/);
  });
});

describe('runBackupRestore', () => {
  it('restores through a sink', async () => {
    const fs = memFs();
    const backend = backupModule.createLocalBackend({ root: '/backups', fs });
    const created = await runBackupCreate({
      backend,
      password: 'p',
      source: mkSource(),
      now: () => '2026-04-16T10-00-00Z',
    });
    const captured: Record<string, readonly unknown[]> = {};
    const sink: backupModule.DataSink = {
      async apply(t, rows) { captured[t] = rows; },
    };
    const result = await runBackupRestore({
      backend,
      password: 'p',
      sink,
      key: created.data?.key as string,
    });
    expect(result.exitCode).toBe(0);
    expect(captured.decisions).toHaveLength(1);
    expect(captured.memory).toHaveLength(1);
  });

  it('throws when --key is missing', async () => {
    const fs = memFs();
    const backend = backupModule.createLocalBackend({ root: '/backups', fs });
    await expect(
      runBackupRestore({ backend, password: 'p', sink: { async apply() {} } }),
    ).rejects.toThrow(/--key/);
  });
});

describe('runBackupList', () => {
  it('lists backups from the backend', async () => {
    const fs = memFs();
    const backend = backupModule.createLocalBackend({ root: '/backups', fs });
    await runBackupCreate({ backend, password: 'p', source: mkSource(), now: () => 'a' });
    await runBackupCreate({ backend, password: 'p', source: mkSource(), now: () => 'b' });
    const result = await runBackupList({ backend });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(1);
  });

  it('reports empty state', async () => {
    const fs = memFs();
    const backend = backupModule.createLocalBackend({ root: '/backups', fs });
    const result = await runBackupList({ backend });
    expect(result.stdout[0]).toMatch(/No backups/);
  });
});

describe('localBackend helper', () => {
  it('constructs a backend around node:fs defaults when fs is omitted', () => {
    const backend = localBackend('/tmp/nope-does-not-exist');
    expect(typeof backend.put).toBe('function');
  });
});
