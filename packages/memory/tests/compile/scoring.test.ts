import { describe, expect, it } from 'vitest';
import { DeterministicEmbeddingProvider, serializeEmbedding } from '../../src/decisions/index.js';
import { scoreAll, scoreDecision, DEFAULT_WEIGHTS } from '../../src/compile/scoring.js';
import type { Decision, Outcome } from '../../src/db/schema.js';

const embed = new DeterministicEmbeddingProvider(128);

function mkDecision(partial: Partial<Decision> & { id: string; createdAt?: string }): Decision {
  return {
    id: partial.id,
    projectId: partial.projectId ?? 'p',
    title: partial.title ?? 'Untitled',
    reasoning: partial.reasoning ?? '',
    madeBy: partial.madeBy ?? 'agent:any',
    affects: partial.affects ?? [],
    confidence: partial.confidence ?? 'medium',
    tags: partial.tags ?? [],
    embedding: partial.embedding ?? null,
    supersededBy: partial.supersededBy ?? null,
    status: partial.status ?? 'active',
    createdAt: partial.createdAt ?? new Date().toISOString(),
    updatedAt: partial.updatedAt ?? new Date().toISOString(),
  };
}

describe('scoreDecision: individual signals', () => {
  it('semantic is cosine(query, embedding), clamped at 0', async () => {
    const v = await embed.embed('database postgres durability');
    const d = mkDecision({ id: '1', embedding: serializeEmbedding(v) });
    const s = scoreDecision(d, { queryEmbedding: v });
    expect(s.semantic).toBeCloseTo(1.0, 4);
  });

  it('semantic is 0 when no query embedding or no decision embedding', () => {
    const d = mkDecision({ id: '1' });
    expect(scoreDecision(d, {}).semantic).toBe(0);
  });

  it('tags signal is Jaccard', () => {
    const d = mkDecision({ id: '1', tags: ['database', 'postgres'] });
    const s = scoreDecision(d, { queryTags: ['database', 'redis'] });
    // Intersection {database} = 1, union {database, postgres, redis} = 3 → 1/3
    expect(s.tags).toBeCloseTo(1 / 3);
  });

  it('recency signal decays with age', () => {
    const now = Date.parse('2026-04-15T00:00:00Z');
    const fresh = mkDecision({ id: '1', createdAt: new Date(now - 1000).toISOString() });
    const stale = mkDecision({
      id: '2',
      createdAt: new Date(now - 30 * 86400 * 1000).toISOString(),
    });
    expect(scoreDecision(fresh, { now, recencyHalfLifeDays: 30 }).recency).toBeCloseTo(1.0, 3);
    expect(scoreDecision(stale, { now, recencyHalfLifeDays: 30 }).recency).toBeCloseTo(0.5, 2);
  });

  it('role signal: 1.0 when agent.id matches madeBy', () => {
    const d = mkDecision({ id: '1', madeBy: 'agent:lead' });
    expect(scoreDecision(d, { agent: { id: 'agent:lead', name: 'Lead', role: 'lead' } }).role).toBe(
      1.0,
    );
  });

  it('role signal: 0.5 when agent role in affects', () => {
    const d = mkDecision({ id: '1', madeBy: 'agent:other', affects: ['lead'] });
    expect(scoreDecision(d, { agent: { id: 'agent:lead', name: 'Lead', role: 'lead' } }).role).toBe(
      0.5,
    );
  });

  it('role signal: 0 when no match', () => {
    const d = mkDecision({ id: '1', madeBy: 'agent:other' });
    expect(scoreDecision(d, { agent: { id: 'agent:lead', name: 'L', role: 'lead' } }).role).toBe(0);
  });

  it('outcome signal: +1 validated, -0.5 refuted, 0 missing', () => {
    const d = mkDecision({ id: '1' });
    const validated: Outcome = {
      id: 'o1',
      decisionId: '1',
      result: 'validated',
      evidence: '',
      recordedBy: 'x',
      recordedAt: new Date().toISOString(),
    };
    const refuted: Outcome = { ...validated, id: 'o2', result: 'refuted' };
    expect(scoreDecision(d, { outcomes: new Map([['1', [validated]]]) }).outcome).toBe(1);
    expect(scoreDecision(d, { outcomes: new Map([['1', [refuted]]]) }).outcome).toBe(-0.5);
    expect(scoreDecision(d, {}).outcome).toBe(0);
  });

  it('total is the weighted sum of the 5 signals', () => {
    const d = mkDecision({ id: '1', madeBy: 'a1', tags: ['x'] });
    const s = scoreDecision(d, {
      queryTags: ['x'],
      agent: { id: 'a1', name: 'A', role: 'a' },
    });
    // semantic=0, tags=1, recency≈1, role=1, outcome=0
    // total = 0.35*0 + 0.20*1 + 0.15*1 + 0.15*1 + 0.15*0 = 0.20 + 0.15 + 0.15 = 0.5
    expect(s.total).toBeCloseTo(0.5, 2);
  });
});

describe('scoreAll', () => {
  it('returns decisions sorted by total score descending', () => {
    const a = mkDecision({ id: 'a', tags: ['match'] });
    const b = mkDecision({ id: 'b', tags: ['other'] });
    const c = mkDecision({ id: 'c', tags: ['match', 'more'] });
    const ranked = scoreAll([a, b, c], { queryTags: ['match'] });
    expect(ranked[0]!.decision.id).toBe('a'); // Jaccard 1/1 = 1
    expect(ranked[1]!.decision.id).toBe('c'); // Jaccard 1/2 = 0.5
    expect(ranked[2]!.decision.id).toBe('b'); // 0
  });

  it('weight overrides change ranking', () => {
    const a = mkDecision({ id: 'a', tags: ['x'] }); // high tag match
    const b = mkDecision({ id: 'b', madeBy: 'me' }); // high role match
    const base = scoreAll([a, b], { queryTags: ['x'], agent: { id: 'me', name: 'Me', role: 'r' } });
    // With default weights (tags=0.20, role=0.15) a beats b.
    expect(base[0]!.decision.id).toBe('a');

    const swapped = scoreAll([a, b], {
      queryTags: ['x'],
      agent: { id: 'me', name: 'Me', role: 'r' },
      weights: { tags: 0.1, role: 0.5 },
    });
    expect(swapped[0]!.decision.id).toBe('b');
  });
});

describe('DEFAULT_WEIGHTS sums to 1.0', () => {
  it('', () => {
    const w = DEFAULT_WEIGHTS;
    expect(w.semantic + w.tags + w.recency + w.role + w.outcome).toBeCloseTo(1.0, 6);
  });
});
