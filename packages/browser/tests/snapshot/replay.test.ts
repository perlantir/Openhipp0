import { describe, expect, it } from 'vitest';

import { replaySnapshot, replayTrail } from '../../src/snapshot/replay.js';
import {
  SNAPSHOT_SCHEMA_VERSION,
  type SessionId,
  type Snapshot,
  type SnapshotId,
} from '../../src/snapshot/types.js';
import { createFakeContext, createFakePage } from './fake-page.js';

function mkSnap(patch: Partial<Snapshot> = {}): Snapshot {
  return {
    version: SNAPSHOT_SCHEMA_VERSION,
    id: 'snap' as SnapshotId,
    sessionId: 'sess' as SessionId,
    takenAt: new Date().toISOString(),
    url: 'https://target/',
    title: 'Target',
    ax: null,
    dom: { hash: 'd' },
    screenshot: { hash: 's' },
    network: [],
    console: [],
    cookies: [{ name: 'session', value: 'abc', domain: 'target', path: '/' }],
    ...patch,
  };
}

describe('replaySnapshot', () => {
  it('navigates, restores cookies, waits for title match', async () => {
    const { page, calls } = createFakePage({
      url: 'about:blank',
      title: 'Target',
      html: '',
      png: Buffer.alloc(0),
      ax: null,
    });
    const { context, addedCookies } = createFakeContext();
    const result = await replaySnapshot(mkSnap(), { context, page }, { waitTimeoutMs: 100 });
    expect(result.ok).toBe(true);
    expect(addedCookies).toHaveLength(1);
    expect(calls.some((c) => c.startsWith('goto:'))).toBe(true);
    expect(result.actions).toContain('title-matched');
  });

  it('warns when title never matches within timeout', async () => {
    const { page } = createFakePage({
      url: 'about:blank',
      title: 'Wrong',
      html: '',
      png: Buffer.alloc(0),
      ax: null,
    });
    const { context } = createFakeContext();
    const result = await replaySnapshot(
      mkSnap({ title: 'Expected' }),
      { context, page },
      { waitTimeoutMs: 50 },
    );
    expect(result.ok).toBe(false);
    expect(result.warnings.some((w) => w.includes('title mismatch'))).toBe(true);
  });

  it('replayTrail applies each snapshot in order', async () => {
    const { page } = createFakePage({
      url: 'about:blank',
      title: 'x',
      html: '',
      png: Buffer.alloc(0),
      ax: null,
    });
    const { context } = createFakeContext();
    const trail = [
      mkSnap({ url: 'https://a/', title: 'x' }),
      mkSnap({ url: 'https://b/', title: 'x' }),
      mkSnap({ url: 'https://c/', title: 'x' }),
    ];
    const results = await replayTrail(trail, { context, page }, { waitTimeoutMs: 50 });
    expect(results.length).toBe(3);
  });
});
