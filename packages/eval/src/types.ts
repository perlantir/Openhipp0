/**
 * Core eval types — a single vocabulary across published-benchmark adapters
 * and original Open Hipp0 benchmarks (memory recall, self-learning).
 */

export type EvalTier = 'smoke' | 'regression' | 'full';

export interface EvalMetrics {
  /** Did the case pass its own `verify` check? */
  success: boolean;
  /** Wall-clock time for the run step, in ms. */
  latencyMs: number;
  /** Total LLM spend for the run step, in USD. Zero if no LLM calls. */
  costUsd: number;
  /** Number of tool calls the agent made during the run. */
  toolCalls: number;
  /**
   * Number of human-intervention events the agent requested during the run
   * (governance approvals, clarifications). Lower is better.
   */
  interventions: number;
  /**
   * Fraction of policy/permission checks honored (1 = all honored, 0 = all
   * bypassed). 1 when no checks occurred.
   */
  safetyScore: number;
}

export interface EvalCase<TContext = unknown, TResult = unknown> {
  /** Stable machine id. Used as the regression-threshold key. */
  id: string;
  /** Human name for reports. */
  name: string;
  /** Which suites this case belongs to. A case may belong to more than one. */
  tiers: readonly EvalTier[];
  /**
   * Free-form labels. Benchmark adapters set tags like `'tau-bench'`,
   * `'memory-recall'`, `'safety'`; suites may filter by them.
   */
  tags?: readonly string[];
  /** Optional setup run once before `run`. Returns a case-scoped context. */
  setup?(): Promise<TContext> | TContext;
  /** The actual run step. Returns whatever the verify step needs. */
  run(ctx: TContext): Promise<TResult> | TResult;
  /**
   * Pure verification against the run output. Throwing / returning false
   * marks the case as failing. May be async if the verifier calls out.
   */
  verify(result: TResult, ctx: TContext): Promise<boolean> | boolean;
  /** Optional teardown; always runs even if `run` or `verify` threw. */
  teardown?(ctx: TContext): Promise<void> | void;
}

export interface EvalCaseResult {
  readonly caseId: string;
  readonly caseName: string;
  readonly metrics: EvalMetrics;
  readonly error?: string;
}

export interface EvalSuiteResult {
  readonly tier: EvalTier;
  readonly cases: readonly EvalCaseResult[];
  readonly aggregate: EvalMetrics;
  readonly thresholdsPassed: boolean;
  /** Failure reasons per threshold id, if any. */
  readonly thresholdFailures: readonly string[];
}

/**
 * Signals captured by the runner without the case having to plumb them
 * through by hand. Populated from the environment the runner constructs
 * (LLM cost tracker, tool registry, policy engine).
 */
export interface RunCaptures {
  addCostUsd(usd: number): void;
  incToolCalls(n?: number): void;
  incInterventions(n?: number): void;
  /** `honored = true` → allowed by policy; `false` → denied. */
  recordPolicyCheck(honored: boolean): void;
}
