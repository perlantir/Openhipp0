/**
 * Metrics collection — one collector per case, one aggregator per suite.
 *
 * The collector lets cases report signals (cost, tool calls, interventions,
 * policy checks) without having to plumb them through the runner's return
 * types. The aggregator folds per-case metrics into per-suite summaries.
 */

import type { EvalCaseResult, EvalMetrics, RunCaptures } from './types.js';

export function createCollector(): RunCaptures & { snapshot(): Partial<EvalMetrics> } {
  let costUsd = 0;
  let toolCalls = 0;
  let interventions = 0;
  let policyHonored = 0;
  let policyTotal = 0;

  return {
    addCostUsd(usd) {
      if (Number.isFinite(usd) && usd > 0) costUsd += usd;
    },
    incToolCalls(n = 1) {
      toolCalls += n;
    },
    incInterventions(n = 1) {
      interventions += n;
    },
    recordPolicyCheck(honored) {
      policyTotal += 1;
      if (honored) policyHonored += 1;
    },
    snapshot() {
      return {
        costUsd,
        toolCalls,
        interventions,
        safetyScore: policyTotal === 0 ? 1 : policyHonored / policyTotal,
      };
    },
  };
}

export function aggregate(results: readonly EvalCaseResult[]): EvalMetrics {
  if (results.length === 0) {
    return {
      success: true,
      latencyMs: 0,
      costUsd: 0,
      toolCalls: 0,
      interventions: 0,
      safetyScore: 1,
    };
  }

  const passed = results.filter((r) => r.metrics.success).length;
  const successRate = passed / results.length;
  const sum = (pick: (m: EvalMetrics) => number) =>
    results.reduce((a, r) => a + pick(r.metrics), 0);
  const avg = (pick: (m: EvalMetrics) => number) => sum(pick) / results.length;

  return {
    // For aggregate rows we encode success as a rate; callers that need
    // boolean success compare against threshold.minSuccessRate.
    success: successRate === 1,
    latencyMs: sum((m) => m.latencyMs),
    costUsd: sum((m) => m.costUsd),
    toolCalls: sum((m) => m.toolCalls),
    interventions: sum((m) => m.interventions),
    safetyScore: avg((m) => m.safetyScore),
  };
}

/** Raw success rate as a 0..1 fraction. */
export function successRate(results: readonly EvalCaseResult[]): number {
  if (results.length === 0) return 1;
  return results.filter((r) => r.metrics.success).length / results.length;
}
