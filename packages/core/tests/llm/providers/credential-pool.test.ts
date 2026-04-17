import { describe, expect, it } from 'vitest';

import { CredentialPool } from '../../../src/llm/providers/credential-pool.js';

describe('CredentialPool', () => {
  it('rotates round-robin across keys', () => {
    const pool = new CredentialPool([
      { id: 'a', key: 'k1' },
      { id: 'b', key: 'k2' },
      { id: 'c', key: 'k3' },
    ]);
    const picked = [pool.next()?.id, pool.next()?.id, pool.next()?.id, pool.next()?.id];
    expect(picked.slice(0, 3).sort()).toEqual(['a', 'b', 'c']);
  });

  it('disables a key after N consecutive failures and reinstates after cooldown', () => {
    let now = 1_000;
    const pool = new CredentialPool(
      [
        { id: 'a', key: 'k1' },
        { id: 'b', key: 'k2' },
      ],
      { now: () => now, maxFailuresBeforeDisable: 2, cooldownMs: 500 },
    );
    pool.reportFailure('a');
    pool.reportFailure('a');
    // 'a' now disabled; next() should only return 'b'.
    expect(pool.next()?.id).toBe('b');
    expect(pool.next()?.id).toBe('b');
    now += 600;
    // after cooldown, 'a' is eligible again.
    const ids = new Set([pool.next()?.id, pool.next()?.id]);
    expect(ids.has('a')).toBe(true);
  });

  it('tag filter narrows the pool', () => {
    const pool = new CredentialPool([
      { id: 'p1', key: 'x', tags: ['prod'] },
      { id: 'p2', key: 'y', tags: ['dev'] },
    ]);
    const picked = pool.next(['prod']);
    expect(picked?.id).toBe('p1');
  });
});
