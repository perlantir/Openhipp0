import { describe, expect, it } from 'vitest';

import { ProxyRotator } from '../../src/stealth/proxy-rotation.js';

const POOL = [
  { id: 'p1', url: 'http://one', tags: ['us'] },
  { id: 'p2', url: 'http://two', tags: ['us', 'residential'] },
  { id: 'p3', url: 'http://three', tags: ['eu'] },
];

describe('ProxyRotator', () => {
  it('round-robin walks the pool', () => {
    const r = new ProxyRotator(POOL, 'round-robin');
    expect(r.next()?.id).toBe('p1');
    expect(r.next()?.id).toBe('p2');
    expect(r.next()?.id).toBe('p3');
    expect(r.next()?.id).toBe('p1');
  });

  it('random uses the injected RNG', () => {
    let calls = 0;
    const r = new ProxyRotator(POOL, 'random', {}, () => (calls++ % POOL.length) / POOL.length);
    const a = r.next()!.id;
    const b = r.next()!.id;
    expect([a, b].every((id) => POOL.some((p) => p.id === id))).toBe(true);
  });

  it('per-host stickiness returns the same proxy for the same host', () => {
    const r = new ProxyRotator(POOL, 'per-host', {}, () => 0);
    const first = r.next({ host: 'example.com' });
    const second = r.next({ host: 'example.com' });
    expect(first?.id).toBe(second?.id);
    const other = r.next({ host: 'other.com' });
    expect(other?.id).toBeTruthy();
  });

  it('per-task stickiness returns the same proxy for the same taskId', () => {
    const r = new ProxyRotator(POOL, 'per-task', {}, () => 0);
    const a = r.next({ taskId: 't1' });
    const b = r.next({ taskId: 't1' });
    expect(a?.id).toBe(b?.id);
  });

  it('tag filter excludes proxies missing required tags', () => {
    const r = new ProxyRotator(POOL, 'round-robin');
    const p = r.next({ tags: ['residential'] });
    expect(p?.id).toBe('p2');
  });

  it('returns null on empty pool after filtering', () => {
    const r = new ProxyRotator(POOL, 'round-robin');
    expect(r.next({ tags: ['no-such'] })).toBeNull();
  });
});
