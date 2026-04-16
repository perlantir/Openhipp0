import { describe, expect, it, vi } from 'vitest';
import { OutboundQueue } from '../src/queue.js';

describe('OutboundQueue', () => {
  it('enqueue + size tracks entries', () => {
    const q = new OutboundQueue<string>();
    q.enqueue('c1', 'hello');
    q.enqueue('c1', 'world');
    expect(q.size()).toBe(2);
  });

  it('drops oldest on capacity overflow and invokes onDrop', () => {
    const onDrop = vi.fn();
    const q = new OutboundQueue<string>({ capacity: 2, onDrop });
    q.enqueue('c', 'a');
    q.enqueue('c', 'b');
    q.enqueue('c', 'c');
    expect(q.size()).toBe(2);
    expect(onDrop).toHaveBeenCalledOnce();
    expect(onDrop.mock.calls[0]![0].payload).toBe('a');
    expect(onDrop.mock.calls[0]![1]).toBe('capacity');
  });

  it('drops entries older than maxAgeMs (on next op)', () => {
    let t = 1000;
    const onDrop = vi.fn();
    const q = new OutboundQueue<string>({
      maxAgeMs: 100,
      now: () => t,
      onDrop,
    });
    q.enqueue('c', 'old');
    t += 101;
    q.enqueue('c', 'new');
    // Enqueuing 'new' triggered evictExpired → 'old' dropped.
    expect(q.size()).toBe(1);
    expect(q.peek()[0]!.payload).toBe('new');
    expect(onDrop).toHaveBeenCalledWith(expect.objectContaining({ payload: 'old' }), 'age');
  });

  it('flush delivers entries in order', async () => {
    const q = new OutboundQueue<string>();
    q.enqueue('c1', 'one');
    q.enqueue('c1', 'two');
    q.enqueue('c2', 'three');
    const delivered: Array<{ channelId: string; payload: string }> = [];
    const n = await q.flush(async (e) => {
      delivered.push({ channelId: e.channelId, payload: e.payload });
    });
    expect(n).toBe(3);
    expect(delivered).toEqual([
      { channelId: 'c1', payload: 'one' },
      { channelId: 'c1', payload: 'two' },
      { channelId: 'c2', payload: 'three' },
    ]);
    expect(q.size()).toBe(0);
  });

  it('flush stops at first failure, leaves entry at head', async () => {
    const q = new OutboundQueue<string>();
    q.enqueue('c', 'a');
    q.enqueue('c', 'b');
    q.enqueue('c', 'c');
    let count = 0;
    const n = await q.flush(async () => {
      count++;
      if (count === 2) throw new Error('nope');
    });
    expect(n).toBe(1);
    expect(q.size()).toBe(2);
    expect(q.peek()[0]!.payload).toBe('b');
  });

  it('clear empties the queue without invoking onDrop', () => {
    const onDrop = vi.fn();
    const q = new OutboundQueue<string>({ onDrop });
    q.enqueue('c', 'a');
    q.enqueue('c', 'b');
    q.clear();
    expect(q.size()).toBe(0);
    expect(onDrop).not.toHaveBeenCalled();
  });
});
