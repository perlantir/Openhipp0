import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SnapshotStore } from '../../src/snapshot/store.js';
import {
  SNAPSHOT_SCHEMA_VERSION,
  type SessionId,
  type Snapshot,
  type SnapshotId,
} from '../../src/snapshot/types.js';

const SESSION = 'sess' as SessionId;

function mkSnap(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    version: SNAPSHOT_SCHEMA_VERSION,
    id: `id-${Math.random().toString(16).slice(2, 10)}` as SnapshotId,
    sessionId: SESSION,
    takenAt: new Date().toISOString(),
    url: 'https://example.com',
    title: 't',
    ax: null,
    dom: { hash: 'd', contentGzB64: 'Zg==' },
    screenshot: { hash: 's', pngB64: 'AA==' },
    network: [],
    console: [],
    cookies: [],
    ...overrides,
  };
}

describe('SnapshotStore', () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'hipp0-snap-store-'));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('saves and loads a snapshot', async () => {
    const store = new SnapshotStore({ root });
    const snap = mkSnap();
    const { filePath, bytes } = await store.save(snap);
    expect(bytes).toBeGreaterThan(0);
    const round = await store.load(filePath);
    expect(round.id).toBe(snap.id);
    expect(round.url).toBe(snap.url);
  });

  it('enforces maxPerSession by pruning oldest', async () => {
    const store = new SnapshotStore({
      root,
      retention: { maxPerSession: 2, maxTotalBytes: undefined, maxAgeMs: undefined },
    });
    const snaps = [mkSnap(), mkSnap(), mkSnap(), mkSnap()];
    for (const s of snaps) await store.save(s);
    const files = await store.listSessionFiles(SESSION);
    expect(files.length).toBe(2);
  });

  it('resolveFull walks refPrevId chains within a session', async () => {
    const store = new SnapshotStore({ root });
    const first = mkSnap({
      id: 'base' as SnapshotId,
      dom: { hash: 'h1', contentGzB64: 'AAAA' },
      screenshot: { hash: 's1', pngB64: 'BBBB' },
    });
    const second = mkSnap({
      id: 'chained' as SnapshotId,
      dom: { hash: 'h1', refPrevId: first.id },
      screenshot: { hash: 's1', refPrevId: first.id },
    });
    await store.save(first);
    await store.save(second);
    const resolved = await store.resolveFull(second);
    expect(resolved.dom.contentGzB64).toBe('AAAA');
    expect(resolved.screenshot.pngB64).toBe('BBBB');
  });

  it('lists sessions and session files', async () => {
    const store = new SnapshotStore({ root });
    await store.save(mkSnap({ sessionId: 'sA' as SessionId }));
    await store.save(mkSnap({ sessionId: 'sB' as SessionId }));
    const sessions = await store.listSessions();
    expect(new Set(sessions)).toEqual(new Set(['sA', 'sB']));
  });

  it('age-prunes files older than maxAgeMs', async () => {
    const now = { t: 1_000_000_000 }; // ms epoch
    const store = new SnapshotStore({
      root,
      retention: { maxAgeMs: 500, maxPerSession: undefined, maxTotalBytes: undefined },
      now: () => now.t,
    });
    await store.save(mkSnap());
    // Age files by editing mtime to 1 hour in the past.
    const files = await store.listSessionFiles(SESSION);
    const fakePast = (now.t - 60 * 60 * 1000) / 1000;
    await Promise.all(files.map((f) => fs.utimes(f, fakePast, fakePast)));
    // Save a second snapshot — prune should fire against the aged file.
    await store.save(mkSnap());
    const remaining = await store.listSessionFiles(SESSION);
    expect(remaining.length).toBe(1);
  });
});
