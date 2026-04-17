/**
 * Comparison runner contracts. Each `CompetitorHarness` implementation
 * drives a different agent platform (Open Hipp0, OpenClaw, Hermes)
 * against the same benchmark task and captures comparable metrics.
 *
 * Real-world usage: operators stand up Docker images for each
 * competitor (Hermes runs via `hermes-agent` container, OpenClaw via
 * `openclaw serve`), wire those as competitor harnesses, and run the
 * same corpus through each.
 */

export interface BenchmarkTaskRun {
  readonly taskId: string;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly success: boolean;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly toolCallCount: number;
  readonly latencyMs: number;
  readonly transcriptExcerpt?: string;
  readonly failureReason?: string;
}

export interface CompetitorHarness<TTask = unknown> {
  readonly name: 'openhipp0' | 'openclaw' | 'hermes' | string;
  readonly version: string;
  run(task: TTask): Promise<BenchmarkTaskRun>;
}

export interface ComparisonReport<TTask = unknown> {
  readonly taskCount: number;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly perHarness: Readonly<Record<string, HarnessSummary>>;
  readonly perTask: readonly PerTaskComparison<TTask>[];
}

export interface HarnessSummary {
  readonly name: string;
  readonly version: string;
  readonly successRate: number;
  readonly avgLatencyMs: number;
  readonly totalCostUsd: number;
  readonly totalTokens: number;
  readonly avgToolCalls: number;
}

export interface PerTaskComparison<TTask = unknown> {
  readonly task: TTask;
  readonly runs: Readonly<Record<string, BenchmarkTaskRun>>;
}
