/**
 * Tiered suite helpers — filter a case list by tier and run it.
 *
 * Usage:
 *   const cases = [
 *     ...BUILTIN_RECALL_TASKS.map((t) => memoryRecall.taskToCase(t, { agent })),
 *     ...BUILTIN_TAU_BENCH_TASKS.map((t) => tauBench.taskToCase(t, { agent })),
 *   ];
 *   const result = await runSmoke(cases);
 *
 * Callers that want to override thresholds pass `opts.thresholds`.
 */

import { runTier, type RunOptions } from './runner.js';
import type { EvalCase, EvalSuiteResult } from './types.js';

export function runSmoke(cases: readonly EvalCase[], opts?: RunOptions): Promise<EvalSuiteResult> {
  return runTier('smoke', cases, opts);
}
export function runRegression(
  cases: readonly EvalCase[],
  opts?: RunOptions,
): Promise<EvalSuiteResult> {
  return runTier('regression', cases, opts);
}
export function runFull(cases: readonly EvalCase[], opts?: RunOptions): Promise<EvalSuiteResult> {
  return runTier('full', cases, opts);
}
