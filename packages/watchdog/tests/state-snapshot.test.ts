import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hipp0SnapshotCorruptError, SNAPSHOT_VERSION, StateSnapshotStore } from '../src/index.js';

describe('StateSnapshotStore', () => {
  let dir: string;
  let store: StateSnapshotStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hipp0-snap-'));
    store = new StateSnapshotStore(path.join(dir, 'snapshot.json'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns null when no snapshot file exists', async () => {
    expect(await store.load()).toBeNull();
  });

  it('round-trips a saved snapshot', async () => {
    const saved = await store.save({
      sessionsActive: 3,
      recentDecisionIds: ['d1', 'd2'],
      custom: { foo: 'bar' },
    });
    expect(saved.version).toBe(SNAPSHOT_VERSION);
    expect(saved.sessionsActive).toBe(3);
    expect(saved.pid).toBe(process.pid);

    const loaded = await store.load();
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionsActive).toBe(3);
    expect(loaded!.recentDecisionIds).toEqual(['d1', 'd2']);
    expect(loaded!.custom).toEqual({ foo: 'bar' });
    expect(loaded!.lastSafeModeAt).toBeNull();
  });

  it('writes atomically — no .tmp file lingers after success', async () => {
    await store.save({ sessionsActive: 1 });
    const entries = await fs.readdir(dir);
    expect(entries).toEqual(['snapshot.json']);
  });

  it('creates the parent directory if missing', async () => {
    const nested = new StateSnapshotStore(path.join(dir, 'a', 'b', 'snapshot.json'));
    await nested.save({});
    expect(await nested.load()).not.toBeNull();
  });

  it('throws Hipp0SnapshotCorruptError on garbage JSON', async () => {
    await fs.writeFile(path.join(dir, 'snapshot.json'), '{{not json', 'utf8');
    await expect(store.load()).rejects.toBeInstanceOf(Hipp0SnapshotCorruptError);
  });

  it('throws Hipp0SnapshotCorruptError on schema mismatch', async () => {
    await fs.writeFile(
      path.join(dir, 'snapshot.json'),
      JSON.stringify({ version: 999, savedAt: 'x', pid: -1, uptimeSeconds: -1 }),
      'utf8',
    );
    await expect(store.load()).rejects.toBeInstanceOf(Hipp0SnapshotCorruptError);
  });

  it('clear() removes the file and is idempotent', async () => {
    await store.save({});
    await store.clear();
    await store.clear(); // idempotent — no error on missing file
    expect(await store.load()).toBeNull();
  });

  it('persists lastSafeModeAt when supplied', async () => {
    const stamp = '2026-04-16T12:00:00.000Z';
    await store.save({ lastSafeModeAt: stamp });
    const loaded = await store.load();
    expect(loaded!.lastSafeModeAt).toBe(stamp);
  });
});
