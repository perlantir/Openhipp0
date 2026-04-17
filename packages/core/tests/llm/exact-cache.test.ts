import { describe, expect, it } from 'vitest';
import { ExactCache, cacheKey } from '../../src/llm/exact-cache.js';
import type { LLMResponse, Message } from '../../src/llm/types.js';

const msg = (text: string): Message => ({ role: 'user', content: text });
const resp: LLMResponse = {
  content: [{ type: 'text', text: 'ok' }],
  stopReason: 'end_turn',
  usage: { inputTokens: 100, outputTokens: 50 },
  model: 'fake',
  provider: 'fake',
};

describe('cacheKey', () => {
  it('returns the same hash for identical inputs', () => {
    const a = cacheKey([msg('hi')], { temperature: 0.5 });
    const b = cacheKey([msg('hi')], { temperature: 0.5 });
    expect(a).toBe(b);
  });

  it('differs when content differs', () => {
    expect(cacheKey([msg('hi')], {})).not.toBe(cacheKey([msg('bye')], {}));
  });

  it('differs when options differ', () => {
    expect(cacheKey([msg('hi')], { temperature: 0.1 })).not.toBe(
      cacheKey([msg('hi')], { temperature: 0.9 }),
    );
  });

  it('is stable across key-order permutations of nested objects', () => {
    const a = cacheKey([msg('hi')], { system: 's', temperature: 0.1 });
    const b = cacheKey([msg('hi')], { temperature: 0.1, system: 's' });
    expect(a).toBe(b);
  });
});

describe('ExactCache', () => {
  it('returns null on miss', () => {
    const c = new ExactCache();
    expect(c.get([msg('hi')])).toBeNull();
    expect(c.stats().misses).toBe(1);
    expect(c.stats().hits).toBe(0);
  });

  it('returns cached response on hit, with zeroed usage', () => {
    const c = new ExactCache();
    c.set([msg('hi')], {}, resp);
    const got = c.get([msg('hi')]);
    expect(got?.content).toEqual(resp.content);
    expect(got?.usage.inputTokens).toBe(0);
    expect(got?.usage.outputTokens).toBe(0);
    expect(c.stats().hits).toBe(1);
  });

  it('expires entries after TTL', () => {
    let now = 0;
    const c = new ExactCache({ ttlMs: 100, now: () => now });
    c.set([msg('hi')], {}, resp);
    now = 50;
    expect(c.get([msg('hi')])).not.toBeNull();
    now = 150;
    expect(c.get([msg('hi')])).toBeNull();
  });

  it('evicts LRU when maxEntries exceeded', () => {
    let now = 0;
    const c = new ExactCache({ maxEntries: 2, now: () => now });
    c.set([msg('a')], {}, resp); now = 1;
    c.set([msg('b')], {}, resp); now = 2;
    c.set([msg('c')], {}, resp); now = 3;
    expect(c.stats().size).toBe(2);
    expect(c.stats().evictions).toBe(1);
    expect(c.get([msg('a')])).toBeNull(); // a was evicted
    expect(c.get([msg('c')])).not.toBeNull();
  });

  it('clear() drops all entries', () => {
    const c = new ExactCache();
    c.set([msg('hi')], {}, resp);
    c.clear();
    expect(c.get([msg('hi')])).toBeNull();
    expect(c.stats().size).toBe(0);
  });
});
