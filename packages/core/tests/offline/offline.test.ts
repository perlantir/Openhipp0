import { describe, expect, it } from 'vitest';
import {
  OutboundActionQueue,
  resolveConflict,
  strategyForKind,
  cacheFirstRead,
  createMemoryCache,
  OnlineStatusTracker,
  stubLocalLLM,
  type QueuedAction,
} from '../../src/offline/index.js';

describe('OutboundActionQueue', () => {
  it('enqueues + drains in order + removes on success', async () => {
    const q = new OutboundActionQueue();
    q.enqueue('msg', { t: 'a' });
    q.enqueue('msg', { t: 'b' });
    const seen: string[] = [];
    const result = await q.drain(async (a) => {
      seen.push((a.payload as { t: string }).t);
    });
    expect(result.processed).toBe(2);
    expect(seen).toEqual(['a', 'b']);
    expect(q.size()).toBe(0);
  });

  it('retries on failure + increments attempts', async () => {
    const q = new OutboundActionQueue();
    q.enqueue('msg', 1);
    await q.drain(async () => { throw new Error('fail-once'); });
    expect(q.peek()[0]?.attempts).toBe(1);
    expect(q.peek()[0]?.lastError).toBe('fail-once');
    expect(q.size()).toBe(1);
  });

  it('drops action after maxAttempts', async () => {
    const q = new OutboundActionQueue();
    q.enqueue('msg', 1);
    for (let i = 0; i < 4; i++) {
      await q.drain(async () => { throw new Error('fail'); }, { maxAttempts: 3 });
    }
    expect(q.size()).toBe(0);
  });

  it('drops oldest on overflow', () => {
    const q = new OutboundActionQueue({ maxSize: 2 });
    const a = q.enqueue('msg', 1);
    q.enqueue('msg', 2);
    q.enqueue('msg', 3);
    expect(q.size()).toBe(2);
    expect(q.peek().some((x) => x.id === a.id)).toBe(false);
  });

  it('restores from persistence', async () => {
    const stored: QueuedAction[] = [
      { id: 'x', kind: 'a', payload: 1, createdAt: 0, attempts: 0, seq: 5 },
    ];
    const q = new OutboundActionQueue({}, { async load() { return stored; }, async save() {} });
    await q.restore();
    expect(q.size()).toBe(1);
    expect(q.peek()[0]?.seq).toBe(5);
  });
});

describe('conflict resolver', () => {
  it('server-wins returns remote', () => {
    const res = resolveConflict(
      { id: '1', updatedAt: '2026-04-16T11:00:00Z', x: 1 },
      { id: '1', updatedAt: '2026-04-16T10:00:00Z', x: 2 },
      'server-wins',
    );
    expect(res.winner.x).toBe(2);
  });

  it('last-write-wins returns newer', () => {
    const res = resolveConflict(
      { id: '1', updatedAt: '2026-04-16T11:00:00Z', x: 1 },
      { id: '1', updatedAt: '2026-04-16T10:00:00Z', x: 2 },
      'last-write-wins',
    );
    expect(res.winner.x).toBe(1);
  });

  it('strategyForKind returns expected defaults', () => {
    expect(strategyForKind('decision')).toBe('server-wins');
    expect(strategyForKind('preference')).toBe('last-write-wins');
    expect(strategyForKind('unknown')).toBe('server-wins');
    expect(strategyForKind('audit-event')).toBe('server-wins');
  });
});

describe('cacheFirstRead', () => {
  it('returns cache when fresh', async () => {
    const store = createMemoryCache();
    await store.set('decision', 'd1', { id: 'd1', title: 'hi' });
    const out = await cacheFirstRead(store, async () => null, 'decision', 'd1');
    expect(out.source).toBe('cache');
    expect((out.value as { title: string }).title).toBe('hi');
  });

  it('hits remote on miss and writes back', async () => {
    const store = createMemoryCache();
    const out = await cacheFirstRead(store, async () => ({ id: 'd1', title: 'fresh' }), 'decision', 'd1');
    expect(out.source).toBe('remote');
    const after = await store.get('decision', 'd1');
    expect(after).not.toBeNull();
  });

  it('falls back to stale cache when remote throws (forceRefresh)', async () => {
    const store = createMemoryCache();
    await store.set('decision', 'd1', { id: 'd1', title: 'stale' });
    const out = await cacheFirstRead(
      store,
      async () => { throw new Error('offline'); },
      'decision', 'd1',
      { forceRefresh: true },
    );
    expect(out.source).toBe('stale-cache');
  });

  it('returns miss when no cache and no remote', async () => {
    const store = createMemoryCache();
    const out = await cacheFirstRead(store, async () => null, 'decision', 'missing');
    expect(out.source).toBe('miss');
    expect(out.value).toBeNull();
  });
});

describe('OnlineStatusTracker', () => {
  it('transitions to offline when probe fails', async () => {
    const tracker = new OnlineStatusTracker({ probe: async () => ({ ok: false }) });
    const seen: string[] = [];
    tracker.on((next, prev) => seen.push(`${prev}→${next}`));
    await tracker.tick();
    expect(tracker.status()).toBe('offline');
    expect(seen).toEqual(['online→offline']);
  });

  it('transitions to degraded on high latency', async () => {
    const tracker = new OnlineStatusTracker({
      probe: async () => ({ ok: true, latencyMs: 5000 }),
      degradedLatencyMs: 1000,
    });
    await tracker.tick();
    expect(tracker.status()).toBe('degraded');
  });

  it('stays online on healthy probe', async () => {
    const tracker = new OnlineStatusTracker({
      probe: async () => ({ ok: true, latencyMs: 100 }),
    });
    await tracker.tick();
    expect(tracker.status()).toBe('online');
  });

  it('rejected probe → offline', async () => {
    const tracker = new OnlineStatusTracker({
      probe: async () => { throw new Error('net'); },
    });
    await tracker.tick();
    expect(tracker.status()).toBe('offline');
  });
});

describe('stubLocalLLM', () => {
  it('summarize trims to maxTokens', async () => {
    const result = await stubLocalLLM.summarize({ text: 'one two three four five six', maxTokens: 3 });
    expect(result.summary).toBe('one two three');
  });

  it('summarize headline pulls first sentence', async () => {
    const result = await stubLocalLLM.summarize({
      text: 'first sentence. second sentence.',
      style: 'headline',
    });
    expect(result.summary).toBe('first sentence');
  });

  it('classify picks matching label', async () => {
    const out = await stubLocalLLM.classify({
      text: 'I love the blue color',
      labels: ['red', 'blue', 'green'],
    });
    expect(out.labels).toEqual(['blue']);
  });

  it('classify multi returns all matches', async () => {
    const out = await stubLocalLLM.classify({
      text: 'red and blue together',
      labels: ['red', 'blue', 'green'],
      multi: true,
    });
    expect([...out.labels].sort()).toEqual(['blue', 'red']);
  });
});
