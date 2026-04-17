import { describe, expect, it } from 'vitest';
import { DEFAULT_SESSION_TAG, isQuarantined, tagRecallHits } from '../../src/injection/tag.js';
import type { RecallHit } from '../../src/recall/index.js';

const mkHit = (id: string, agentId = 'a1'): RecallHit => ({
  session: {
    id,
    projectId: 'p',
    agentId,
    userId: null,
    summary: 's',
    fullText: 't',
    toolCallsCount: 0,
    tokensUsed: 0,
    costUsd: 0,
    lineageParentId: null,
    createdAt: '2026-04-16T00:00:00Z',
  },
  rank: -1,
});

describe('tagRecallHits', () => {
  it('applies DEFAULT_SESSION_TAG with session id as ref by default', () => {
    const tagged = tagRecallHits([mkHit('abc')]);
    expect(tagged[0]?.tag.origin).toBe(DEFAULT_SESSION_TAG.origin);
    expect(tagged[0]?.tag.trust).toBe(DEFAULT_SESSION_TAG.trust);
    expect(tagged[0]?.tag.ref).toBe('abc');
    expect(tagged[0]?.tag.label).toBe('session:a1');
  });

  it('supplier override takes precedence per-hit', () => {
    const tagged = tagRecallHits([mkHit('abc', 'x'), mkHit('def', 'y')], (s) =>
      s.agentId === 'y'
        ? { origin: 'external', trust: 'untrusted', label: 'suspicious' }
        : undefined,
    );
    expect(tagged[0]?.tag.trust).toBe('medium');
    expect(tagged[1]?.tag.trust).toBe('untrusted');
    expect(tagged[1]?.tag.origin).toBe('external');
  });

  it('empty input returns empty output', () => {
    expect(tagRecallHits([])).toEqual([]);
  });
});

describe('tagRecallHits row-level precedence (Follow-up C)', () => {
  it('row-level trust + origin override defaults', () => {
    const hit = mkHit('abc', 'x');
    (hit.session as Record<string, unknown>).origin = 'connector';
    (hit.session as Record<string, unknown>).trust = 'low';
    const tagged = tagRecallHits([hit]);
    expect(tagged[0]?.tag.origin).toBe('connector');
    expect(tagged[0]?.tag.trust).toBe('low');
  });

  it('row-level data beats supplier output', () => {
    const hit = mkHit('abc', 'x');
    (hit.session as Record<string, unknown>).origin = 'external';
    (hit.session as Record<string, unknown>).trust = 'untrusted';
    const tagged = tagRecallHits([hit], () => ({ origin: 'system', trust: 'high' }));
    expect(tagged[0]?.tag.origin).toBe('external');
    expect(tagged[0]?.tag.trust).toBe('untrusted');
  });

  it('row with only trust but no origin still falls back to supplier', () => {
    const hit = mkHit('abc', 'x');
    (hit.session as Record<string, unknown>).trust = 'low';
    // origin missing → supplier (or defaults) wins
    const tagged = tagRecallHits([hit]);
    expect(tagged[0]?.tag.origin).toBe(DEFAULT_SESSION_TAG.origin);
  });
});

describe('isQuarantined', () => {
  it('true for low/untrusted', () => {
    expect(isQuarantined({ origin: 'memory', trust: 'low' })).toBe(true);
    expect(isQuarantined({ origin: 'memory', trust: 'untrusted' })).toBe(true);
  });

  it('false for medium/high', () => {
    expect(isQuarantined({ origin: 'memory', trust: 'medium' })).toBe(false);
    expect(isQuarantined({ origin: 'system', trust: 'high' })).toBe(false);
  });
});
