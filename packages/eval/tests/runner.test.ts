import { describe, expect, it } from 'vitest';
import { getCaptures, runCase, runTier } from '../src/runner.js';
import type { EvalCase } from '../src/types.js';

describe('runner.runCase', () => {
  it('captures success, latency, and signals from a passing case', async () => {
    const c: EvalCase<{ n: number }, { doubled: number }> = {
      id: 'pass',
      name: 'pass',
      tiers: ['smoke'],
      setup: () => ({ n: 2 }),
      async run(ctx) {
        const caps = getCaptures(ctx);
        caps.incToolCalls(3);
        caps.addCostUsd(0.01);
        caps.recordPolicyCheck(true);
        caps.recordPolicyCheck(true);
        return { doubled: ctx.n * 2 };
      },
      verify: (r) => r.doubled === 4,
    };
    const result = await runCase(c);
    expect(result.metrics.success).toBe(true);
    expect(result.metrics.toolCalls).toBe(3);
    expect(result.metrics.costUsd).toBeCloseTo(0.01);
    expect(result.metrics.safetyScore).toBe(1);
    expect(result.metrics.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('marks a case as failing when verify returns false', async () => {
    const c: EvalCase = {
      id: 'fail-verify',
      name: 'fail-verify',
      tiers: ['smoke'],
      run: () => ({}),
      verify: () => false,
    };
    const result = await runCase(c);
    expect(result.metrics.success).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('captures errors thrown during run', async () => {
    const c: EvalCase = {
      id: 'throws',
      name: 'throws',
      tiers: ['smoke'],
      run: () => {
        throw new Error('boom');
      },
      verify: () => true,
    };
    const result = await runCase(c);
    expect(result.metrics.success).toBe(false);
    expect(result.error).toBe('boom');
  });

  it('computes safetyScore as the fraction of honored policy checks', async () => {
    const c: EvalCase = {
      id: 'partial-safety',
      name: 'partial-safety',
      tiers: ['smoke'],
      run(ctx) {
        const caps = getCaptures(ctx);
        caps.recordPolicyCheck(true);
        caps.recordPolicyCheck(true);
        caps.recordPolicyCheck(false);
        return {};
      },
      verify: () => true,
    };
    const result = await runCase(c);
    expect(result.metrics.safetyScore).toBeCloseTo(2 / 3);
  });

  it('always runs teardown', async () => {
    const log: string[] = [];
    const c: EvalCase<{ log: string[] }> = {
      id: 'teardown',
      name: 'teardown',
      tiers: ['smoke'],
      setup: () => ({ log }),
      run: () => ({}),
      verify: () => true,
      teardown(ctx) {
        ctx.log.push('teardown');
      },
    };
    await runCase(c);
    expect(log).toEqual(['teardown']);
  });

  it('teardown runs even when verify throws', async () => {
    const log: string[] = [];
    const c: EvalCase<{ log: string[] }> = {
      id: 'teardown-on-throw',
      name: 'teardown-on-throw',
      tiers: ['smoke'],
      setup: () => ({ log }),
      run: () => ({}),
      verify: () => {
        throw new Error('nope');
      },
      teardown(ctx) {
        ctx.log.push('teardown');
      },
    };
    const result = await runCase(c);
    expect(result.metrics.success).toBe(false);
    expect(log).toEqual(['teardown']);
  });
});

describe('runner.runTier', () => {
  const cases: EvalCase[] = [
    { id: 'a', name: 'a', tiers: ['smoke'], run: () => ({}), verify: () => true },
    { id: 'b', name: 'b', tiers: ['regression'], run: () => ({}), verify: () => true },
    { id: 'c', name: 'c', tiers: ['smoke', 'regression'], run: () => ({}), verify: () => true },
  ];

  it('filters by tier', async () => {
    const result = await runTier('smoke', cases);
    expect(result.cases.map((c) => c.caseId)).toEqual(['a', 'c']);
  });

  it('reports threshold pass when defaults are met', async () => {
    const result = await runTier('smoke', cases);
    expect(result.thresholdsPassed).toBe(true);
    expect(result.thresholdFailures).toEqual([]);
  });

  it('reports threshold failure when minSuccessRate is not met', async () => {
    const failing: EvalCase[] = [
      { id: 'pass', name: 'pass', tiers: ['smoke'], run: () => ({}), verify: () => true },
      { id: 'fail', name: 'fail', tiers: ['smoke'], run: () => ({}), verify: () => false },
    ];
    const result = await runTier('smoke', failing);
    expect(result.thresholdsPassed).toBe(false);
    expect(result.thresholdFailures[0]).toContain('successRate');
  });

  it('respects threshold overrides', async () => {
    const result = await runTier('smoke', cases, {
      thresholds: { maxTotalLatencyMs: 0 },
    });
    // Each case takes > 0 ms so overriding latency to 0 must fail.
    expect(result.thresholdsPassed).toBe(false);
    expect(result.thresholdFailures.join(' ')).toMatch(/totalLatencyMs/);
  });

  it('fires onCaseComplete per case', async () => {
    const seen: string[] = [];
    await runTier('smoke', cases, { onCaseComplete: (r) => seen.push(r.caseId) });
    expect(seen).toEqual(['a', 'c']);
  });
});
