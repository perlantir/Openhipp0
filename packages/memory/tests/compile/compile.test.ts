import { describe, expect, it } from 'vitest';
import {
  compileFromDecisions,
  compressDecisions,
  estimateTokens,
  scoreAll,
} from '../../src/compile/index.js';
import type { Decision } from '../../src/db/schema.js';

function mk(id: string, overrides: Partial<Decision> = {}): Decision {
  return {
    id,
    projectId: 'p',
    title: overrides.title ?? `Decision ${id}`,
    reasoning: overrides.reasoning ?? 'Some reasoning.',
    madeBy: overrides.madeBy ?? 'x',
    affects: overrides.affects ?? [],
    confidence: overrides.confidence ?? 'medium',
    tags: overrides.tags ?? [],
    embedding: overrides.embedding ?? null,
    supersededBy: overrides.supersededBy ?? null,
    status: overrides.status ?? 'active',
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    updatedAt: overrides.updatedAt ?? new Date().toISOString(),
  };
}

describe('compressDecisions', () => {
  const decisions = Array.from({ length: 25 }, (_, i) =>
    mk(String(i), { title: `D${i}`, tags: [i % 3 === 0 ? 'database' : 'frontend'] }),
  );
  const scored = scoreAll(decisions, { queryTags: ['database'] });

  it('markdown: full content for every decision', () => {
    const out = compressDecisions(scored, 'markdown');
    expect(out.decisionCount).toBe(25);
    // Every decision's title should appear.
    for (let i = 0; i < 25; i++) {
      expect(out.body).toContain(`#### D${i}`);
    }
  });

  it('h0c: top 5 full, next 10 titles-only, rest grouped', () => {
    const out = compressDecisions(scored, 'h0c');
    expect(out.decisionCount).toBe(25);
    expect(out.body).toContain('Top decisions');
    expect(out.body).toContain('Other recent decisions');
    expect(out.body).toContain('Related decisions (grouped)');
    // Body should be shorter than the markdown rendering.
    const markdown = compressDecisions(scored, 'markdown');
    expect(out.estTokens).toBeLessThan(markdown.estTokens);
  });

  it('ultra: minimal — top 3 titles + tag-grouped rest', () => {
    const out = compressDecisions(scored, 'ultra');
    expect(out.decisionCount).toBe(25);
    expect(out.body).toContain('Top decisions (titles only)');
    expect(out.body).toContain('Grouped summary');
    const h0c = compressDecisions(scored, 'h0c');
    expect(out.estTokens).toBeLessThan(h0c.estTokens);
  });

  it('handles empty input without crashing', () => {
    const out = compressDecisions([], 'h0c');
    expect(out.decisionCount).toBe(0);
    expect(out.body).toBe('');
  });

  it('compression ratios: h0c is meaningfully smaller than markdown', () => {
    // Build bigger decisions so markdown has real bulk to compress.
    const big = Array.from({ length: 50 }, (_, i) =>
      mk(String(i), {
        title: `Bigger decision ${i}`,
        reasoning: 'A'.repeat(200),
        tags: ['database'],
      }),
    );
    const bigScored = scoreAll(big, { queryTags: ['database'] });
    const md = compressDecisions(bigScored, 'markdown');
    const h0c = compressDecisions(bigScored, 'h0c');
    const ultra = compressDecisions(bigScored, 'ultra');
    // H0C aims for ~8–10x; ultra for ~20–33x. Loose bounds (stub data).
    expect(md.estTokens / h0c.estTokens).toBeGreaterThan(2);
    expect(md.estTokens / ultra.estTokens).toBeGreaterThan(md.estTokens / h0c.estTokens);
  });
});

describe('estimateTokens', () => {
  it('is chars / 4 rounded up', () => {
    expect(estimateTokens('')).toBe(0);
    expect(estimateTokens('abc')).toBe(1);
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
  });
});

describe('compileFromDecisions', () => {
  const decisions = Array.from({ length: 40 }, (_, i) =>
    mk(String(i), { title: `D${i}`, tags: ['x'] }),
  );

  it('returns empty sections when the candidate list is empty', () => {
    const out = compileFromDecisions([], undefined);
    expect(out.sections).toHaveLength(0);
    expect(out.meta.decisionsIncluded).toBe(0);
  });

  it('takes topN candidates and honors format', () => {
    const out = compileFromDecisions(decisions, undefined, {
      topN: 10,
      format: 'markdown',
      tokenBudget: 100_000,
      autoDegrade: false,
    });
    expect(out.sections).toHaveLength(1);
    expect(out.meta.decisionsIncluded).toBe(10);
    expect(out.meta.formatUsed).toBe('markdown');
    expect(out.meta.degraded).toBe(false);
  });

  it('auto-degrades markdown → h0c when over budget', () => {
    const out = compileFromDecisions(decisions, undefined, {
      topN: 40,
      format: 'markdown',
      tokenBudget: 200,
      autoDegrade: true,
    });
    expect(out.meta.degraded).toBe(true);
    // It should end up at h0c or ultra, whichever fits.
    expect(['h0c', 'ultra']).toContain(out.meta.formatUsed);
  });

  it('auto-degrades h0c → ultra when still over budget', () => {
    const out = compileFromDecisions(decisions, undefined, {
      topN: 40,
      format: 'h0c',
      tokenBudget: 50, // very tight
      autoDegrade: true,
    });
    expect(out.meta.degraded).toBe(true);
    expect(out.meta.formatUsed).toBe('ultra');
  });

  it('truncates if ultra still overflows', () => {
    // Force a tiny budget to exercise the truncation branch.
    const out = compileFromDecisions(decisions, undefined, {
      topN: 40,
      format: 'ultra',
      tokenBudget: 5,
      autoDegrade: true,
    });
    expect(out.meta.degraded).toBe(true);
    expect(out.sections[0]!.body).toMatch(/truncated/);
  });

  it('autoDegrade=false leaves format as requested even on overflow', () => {
    const out = compileFromDecisions(decisions, undefined, {
      topN: 40,
      format: 'markdown',
      tokenBudget: 10,
      autoDegrade: false,
    });
    expect(out.meta.formatUsed).toBe('markdown');
    expect(out.meta.degraded).toBe(false);
  });
});
