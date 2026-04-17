import { describe, expect, it, vi } from 'vitest';

import { Debouncer } from '../../src/streaming-edit/debouncer.js';
import type { Timers } from '../../src/streaming-edit/types.js';

/** Deterministic fake timers. `tick(ms)` fires due timeouts immediately. */
function fakeTimers(): Timers & { tick: (ms: number) => void; now: number; pendingCount: () => number } {
  const pending: Array<{ fn: () => void; dueAt: number; id: number }> = [];
  let now = 0;
  let nextId = 1;
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.push({ fn, dueAt: now + ms, id });
      return id;
    },
    clearTimeout(handle) {
      const idx = pending.findIndex((p) => p.id === handle);
      if (idx >= 0) pending.splice(idx, 1);
    },
    tick(ms) {
      now += ms;
      const due = pending.filter((p) => p.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
      for (const p of due) {
        const idx = pending.indexOf(p);
        if (idx >= 0) pending.splice(idx, 1);
        p.fn();
      }
    },
    get now() {
      return now;
    },
    pendingCount() {
      return pending.length;
    },
  };
}

describe('Debouncer', () => {
  it('fires once with the latest pushed text after delayMs of quiet', async () => {
    const timers = fakeTimers();
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const d = new Debouncer({ delayMs: 1000, onFlush, timers });
    d.push('hi ');
    d.push('hi there');
    d.push('hi there, world');
    timers.tick(999);
    expect(onFlush).not.toHaveBeenCalled();
    timers.tick(1);
    // Allow promise microtasks to settle.
    await Promise.resolve();
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]![0]).toBe('hi there, world');
  });

  it('flush() bypasses the timer and fires immediately (DECISION 2)', async () => {
    const timers = fakeTimers();
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const d = new Debouncer({ delayMs: 1000, onFlush, timers });
    d.push('mid-buffer');
    await d.flush();
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0]![0]).toBe('mid-buffer');
    expect(d.idle()).toBe(true);
    // And the original timer is cancelled — advancing time doesn't refire.
    timers.tick(5000);
    await Promise.resolve();
    expect(onFlush).toHaveBeenCalledOnce();
  });

  it('re-push after flush re-arms the timer cleanly (no leaked state)', async () => {
    const timers = fakeTimers();
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const d = new Debouncer({ delayMs: 500, onFlush, timers });
    d.push('one');
    await d.flush();
    d.push('two');
    timers.tick(500);
    await Promise.resolve();
    expect(onFlush).toHaveBeenCalledTimes(2);
    expect(onFlush.mock.calls[1]![0]).toBe('two');
  });

  it('dispose() cancels pending timer + drops buffer; subsequent push is a no-op', async () => {
    const timers = fakeTimers();
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const d = new Debouncer({ delayMs: 1000, onFlush, timers });
    d.push('will be dropped');
    await d.dispose();
    d.push('ignored');
    timers.tick(5000);
    await Promise.resolve();
    expect(onFlush).not.toHaveBeenCalled();
    expect(timers.pendingCount()).toBe(0);
  });
});
