/**
 * Eval runner — consumes an array of EvalCases, runs each one under a fresh
 * metrics collector, aggregates, and checks thresholds.
 *
 * The runner stays agent-agnostic. Cases are responsible for constructing
 * whatever runtime they need (FakeLLMProvider + AgentRuntime, a pure in-process
 * memory-recall check, etc.) and calling `captures.*` to report signals.
 */

import { aggregate, createCollector, successRate } from './metrics.js';
import { DEFAULT_THRESHOLDS, type SuiteThresholds } from './thresholds.js';
import type {
  EvalCase,
  EvalCaseResult,
  EvalMetrics,
  EvalSuiteResult,
  EvalTier,
  RunCaptures,
} from './types.js';

export interface RunOptions {
  /** Overrides merged with DEFAULT_THRESHOLDS[tier]. */
  thresholds?: SuiteThresholds;
  /** Called once per completed case. */
  onCaseComplete?(result: EvalCaseResult): void;
}

export async function runTier(
  tier: EvalTier,
  allCases: readonly EvalCase[],
  opts: RunOptions = {},
): Promise<EvalSuiteResult> {
  const cases = allCases.filter((c) => c.tiers.includes(tier));
  const results: EvalCaseResult[] = [];

  for (const c of cases) {
    const result = await runCase(c);
    results.push(result);
    opts.onCaseComplete?.(result);
  }

  const thresholds: SuiteThresholds = { ...DEFAULT_THRESHOLDS[tier], ...opts.thresholds };
  const agg = aggregate(results);
  const rate = successRate(results);
  const failures = checkThresholds(agg, rate, thresholds);

  return {
    tier,
    cases: results,
    aggregate: agg,
    thresholdsPassed: failures.length === 0,
    thresholdFailures: failures,
  };
}

export async function runCase(c: EvalCase): Promise<EvalCaseResult> {
  const collector = createCollector();
  const captures: RunCaptures = collector;
  let ctx: unknown;
  let start = 0;
  let latencyMs = 0;
  let success = false;
  let errMsg: string | undefined;

  try {
    ctx = await c.setup?.();
    const runCtx = injectCaptures(ctx, captures);
    start = nowMs();
    const result = await c.run(runCtx);
    latencyMs = nowMs() - start;
    success = await c.verify(result, runCtx);
  } catch (err) {
    if (start !== 0 && latencyMs === 0) latencyMs = nowMs() - start;
    errMsg = err instanceof Error ? err.message : String(err);
    success = false;
  } finally {
    if (c.teardown) {
      try {
        await c.teardown(injectCaptures(ctx, captures));
      } catch {
        /* teardown errors are non-fatal — the case already has a result */
      }
    }
  }

  const snap = collector.snapshot();
  const metrics: EvalMetrics = {
    success,
    latencyMs,
    costUsd: snap.costUsd ?? 0,
    toolCalls: snap.toolCalls ?? 0,
    interventions: snap.interventions ?? 0,
    safetyScore: snap.safetyScore ?? 1,
  };

  return {
    caseId: c.id,
    caseName: c.name,
    metrics,
    ...(errMsg !== undefined ? { error: errMsg } : {}),
  };
}

function checkThresholds(
  agg: EvalMetrics,
  rate: number,
  t: SuiteThresholds,
): readonly string[] {
  const out: string[] = [];
  if (t.minSuccessRate !== undefined && rate < t.minSuccessRate) {
    out.push(`successRate ${rate.toFixed(3)} < min ${t.minSuccessRate}`);
  }
  if (t.maxTotalLatencyMs !== undefined && agg.latencyMs > t.maxTotalLatencyMs) {
    out.push(`totalLatencyMs ${agg.latencyMs} > max ${t.maxTotalLatencyMs}`);
  }
  if (t.maxTotalCostUsd !== undefined && agg.costUsd > t.maxTotalCostUsd) {
    out.push(`totalCostUsd ${agg.costUsd.toFixed(4)} > max ${t.maxTotalCostUsd}`);
  }
  if (t.minSafetyScore !== undefined && agg.safetyScore < t.minSafetyScore) {
    out.push(`safetyScore ${agg.safetyScore.toFixed(3)} < min ${t.minSafetyScore}`);
  }
  return out;
}

function injectCaptures(ctx: unknown, captures: RunCaptures): unknown {
  if (ctx === undefined || ctx === null) return { __captures: captures };
  if (typeof ctx !== 'object') return ctx;
  // Attach captures non-enumerably so case code that stringifies the ctx
  // (for debug) doesn't trip over it.
  Object.defineProperty(ctx as object, '__captures', {
    value: captures,
    enumerable: false,
    configurable: true,
  });
  return ctx;
}

/**
 * Case-side helper: pull the captures off the context the runner injected.
 * Returns no-op captures if the case was invoked outside the runner.
 */
export function getCaptures(ctx: unknown): RunCaptures {
  if (ctx && typeof ctx === 'object') {
    const maybe = (ctx as { __captures?: RunCaptures }).__captures;
    if (maybe) return maybe;
  }
  return {
    addCostUsd: () => {},
    incToolCalls: () => {},
    incInterventions: () => {},
    recordPolicyCheck: () => {},
  };
}

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
