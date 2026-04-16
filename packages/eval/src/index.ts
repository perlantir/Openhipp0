/**
 * @openhipp0/eval — Phase 20 evaluation framework.
 *
 * Public surface:
 *   - runTier(tier, cases, opts) / runSmoke / runRegression / runFull
 *   - runCase(case) — one-off helper for tests
 *   - getCaptures(ctx) — case-side helper to report signals to the collector
 *   - types: EvalCase, EvalCaseResult, EvalSuiteResult, EvalMetrics, EvalTier
 *   - DEFAULT_THRESHOLDS — per-tier committed regression floors/ceilings
 *   - Benchmark adapters: tauBench, sweBench, agentBench, gaia (namespaced)
 *   - Original benchmarks: memoryRecall, selfLearning (namespaced)
 */

export type {
  EvalCase,
  EvalCaseResult,
  EvalMetrics,
  EvalSuiteResult,
  EvalTier,
  RunCaptures,
} from './types.js';

export { runTier, runCase, getCaptures } from './runner.js';
export type { RunOptions } from './runner.js';
export { runSmoke, runRegression, runFull } from './suites.js';
export { DEFAULT_THRESHOLDS, type SuiteThresholds } from './thresholds.js';
export { aggregate, successRate, createCollector } from './metrics.js';

export * from './benchmarks/index.js';
export * from './original/index.js';
