import { describe, expect, it, vi } from 'vitest';

import { CrossTabState } from '../../src/multi-tab/cross-tab-state.js';

describe('CrossTabState', () => {
  it('get/set/delete round-trip and snapshot captures all keys', () => {
    const s = new CrossTabState();
    s.set('a', 1);
    s.set('b', 'hi');
    expect(s.get('a')).toBe(1);
    expect(s.get('b')).toBe('hi');
    expect(s.snapshot()).toEqual({ a: 1, b: 'hi' });
    s.delete('a');
    expect(s.get('a')).toBeUndefined();
  });

  it('watch is called on every change across keys', () => {
    const s = new CrossTabState();
    const watcher = vi.fn();
    const off = s.watch(watcher);
    s.set('x', 'v1');
    s.set('y', 5);
    expect(watcher).toHaveBeenCalledTimes(2);
    off();
    s.set('z', 'no-fire');
    expect(watcher).toHaveBeenCalledTimes(2);
  });

  it('watchKey only fires on the target key', () => {
    const s = new CrossTabState();
    const watcher = vi.fn();
    s.watchKey('target', watcher);
    s.set('other', 1);
    s.set('target', 'v1');
    s.set('target', 'v2');
    expect(watcher).toHaveBeenCalledTimes(2);
    expect(watcher.mock.calls[1]![0]).toBe('v2');
    expect(watcher.mock.calls[1]![1]).toBe('v1');
  });
});
