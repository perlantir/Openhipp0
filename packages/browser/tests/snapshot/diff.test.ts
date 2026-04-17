import { describe, expect, it } from 'vitest';

import { compareSnapshots } from '../../src/snapshot/diff.js';
import {
  SNAPSHOT_SCHEMA_VERSION,
  type SessionId,
  type Snapshot,
  type SnapshotId,
} from '../../src/snapshot/types.js';

const SESSION = 'sess' as SessionId;

function mkSnap(patch: Partial<Snapshot>): Snapshot {
  return {
    version: SNAPSHOT_SCHEMA_VERSION,
    id: `snap-${Math.random().toString(16).slice(2, 10)}` as SnapshotId,
    sessionId: SESSION,
    takenAt: new Date().toISOString(),
    url: 'https://x/',
    title: 'X',
    ax: null,
    dom: { hash: 'h1' },
    screenshot: { hash: 's1' },
    network: [],
    console: [],
    cookies: [],
    ...patch,
  };
}

describe('compareSnapshots', () => {
  it('emits url-changed + title-changed', () => {
    const a = mkSnap({ url: 'https://a/', title: 'A' });
    const b = mkSnap({ url: 'https://b/', title: 'B' });
    const d = compareSnapshots(a, b);
    expect(d.entries.some((e) => e.kind === 'url-changed')).toBe(true);
    expect(d.entries.some((e) => e.kind === 'title-changed')).toBe(true);
  });

  it('emits dom-changed and screenshot-changed when hashes differ', () => {
    const a = mkSnap({ dom: { hash: 'd1' }, screenshot: { hash: 's1' } });
    const b = mkSnap({ dom: { hash: 'd2' }, screenshot: { hash: 's2' } });
    const d = compareSnapshots(a, b);
    expect(d.entries.map((e) => e.kind)).toEqual(
      expect.arrayContaining(['dom-changed', 'screenshot-changed']),
    );
  });

  it('classifies a11y tree add / remove / change', () => {
    const a = mkSnap({
      ax: {
        role: 'root',
        children: [
          { role: 'button', name: 'go', value: 'off' },
          { role: 'input', name: 'email' },
        ],
      },
    });
    const b = mkSnap({
      ax: {
        role: 'root',
        children: [
          { role: 'button', name: 'go', value: 'on' }, // changed
          { role: 'input', name: 'password' }, // added (diff name)
          // removed: email
        ],
      },
    });
    const d = compareSnapshots(a, b);
    const kinds = d.entries.map((e) => e.kind);
    expect(kinds).toContain('ax-changed');
    expect(kinds).toContain('ax-added');
    expect(kinds).toContain('ax-removed');
  });

  it('emits new network + console entries', () => {
    const a = mkSnap({});
    const b = mkSnap({
      network: [
        {
          requestId: 'r1',
          method: 'POST',
          url: '/api/x',
          status: 201,
          startedAt: new Date().toISOString(),
        },
      ],
      console: [{ level: 'error', text: 'boom', takenAt: new Date().toISOString() }],
    });
    const d = compareSnapshots(a, b);
    expect(d.entries.some((e) => e.kind === 'network-added')).toBe(true);
    expect(d.entries.some((e) => e.kind === 'console-added')).toBe(true);
  });

  it('diffs cookies add / change / remove', () => {
    const a = mkSnap({
      cookies: [
        { name: 'a', value: '1', domain: 'x', path: '/' },
        { name: 'b', value: 'stay', domain: 'x', path: '/' },
      ],
    });
    const b = mkSnap({
      cookies: [
        { name: 'a', value: '2', domain: 'x', path: '/' }, // changed
        { name: 'c', value: 'new', domain: 'x', path: '/' }, // added
        // removed: b
      ],
    });
    const d = compareSnapshots(a, b);
    const kinds = d.entries.map((e) => e.kind);
    expect(kinds).toContain('cookie-changed');
    expect(kinds).toContain('cookie-added');
    expect(kinds).toContain('cookie-removed');
  });
});
