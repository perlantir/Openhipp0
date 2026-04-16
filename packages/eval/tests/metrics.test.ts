import { describe, expect, it } from 'vitest';
import { aggregate, createCollector, successRate } from '../src/metrics.js';
import type { EvalCaseResult } from '../src/types.js';

describe('createCollector', () => {
  it('sums positive cost and ignores bad numbers', () => {
    const c = createCollector();
    c.addCostUsd(0.1);
    c.addCostUsd(0.2);
    c.addCostUsd(-5);
    c.addCostUsd(Number.NaN);
    c.addCostUsd(Number.POSITIVE_INFINITY);
    expect(c.snapshot().costUsd).toBeCloseTo(0.3);
  });

  it('accumulates tool calls and interventions', () => {
    const c = createCollector();
    c.incToolCalls();
    c.incToolCalls(4);
    c.incInterventions(2);
    const snap = c.snapshot();
    expect(snap.toolCalls).toBe(5);
    expect(snap.interventions).toBe(2);
  });

  it('safetyScore defaults to 1 when no policy checks occurred', () => {
    const c = createCollector();
    expect(c.snapshot().safetyScore).toBe(1);
  });

  it('safetyScore is the honored fraction', () => {
    const c = createCollector();
    c.recordPolicyCheck(true);
    c.recordPolicyCheck(true);
    c.recordPolicyCheck(false);
    c.recordPolicyCheck(false);
    expect(c.snapshot().safetyScore).toBe(0.5);
  });
});

describe('aggregate + successRate', () => {
  const r = (id: string, success: boolean): EvalCaseResult => ({
    caseId: id,
    caseName: id,
    metrics: { success, latencyMs: 10, costUsd: 0.5, toolCalls: 2, interventions: 0, safetyScore: 1 },
  });

  it('sums totals and averages safetyScore', () => {
    const agg = aggregate([r('a', true), r('b', true), r('c', false)]);
    expect(agg.latencyMs).toBe(30);
    expect(agg.costUsd).toBe(1.5);
    expect(agg.toolCalls).toBe(6);
    expect(agg.safetyScore).toBe(1);
  });

  it('empty input yields neutral aggregate', () => {
    const agg = aggregate([]);
    expect(agg.success).toBe(true);
    expect(agg.latencyMs).toBe(0);
    expect(agg.safetyScore).toBe(1);
  });

  it('successRate is pass fraction', () => {
    expect(successRate([r('a', true), r('b', false)])).toBe(0.5);
    expect(successRate([])).toBe(1);
  });
});
