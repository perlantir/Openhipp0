/**
 * Runs the same task list through every supplied harness and aggregates
 * a `ComparisonReport`.
 */

import type {
  BenchmarkTaskRun,
  ComparisonReport,
  CompetitorHarness,
  HarnessSummary,
  PerTaskComparison,
} from './types.js';

export interface RunComparisonOptions<TTask> {
  readonly tasks: readonly TTask[];
  readonly harnesses: readonly CompetitorHarness<TTask>[];
  readonly taskId?: (t: TTask) => string;
  /** Max concurrency per harness. Default 1 (sequential). */
  readonly concurrency?: number;
}

export async function runComparison<TTask>(
  opts: RunComparisonOptions<TTask>,
): Promise<ComparisonReport<TTask>> {
  const startedAt = new Date().toISOString();
  const perTask: PerTaskComparison<TTask>[] = [];
  const harnessRuns: Record<string, BenchmarkTaskRun[]> = {};
  for (const h of opts.harnesses) harnessRuns[h.name] = [];

  for (const task of opts.tasks) {
    const runs: Record<string, BenchmarkTaskRun> = {};
    await Promise.all(
      opts.harnesses.map(async (h) => {
        try {
          const r = await h.run(task);
          runs[h.name] = r;
          harnessRuns[h.name]!.push(r);
        } catch (err) {
          const failed: BenchmarkTaskRun = {
            taskId: opts.taskId?.(task) ?? 'unknown',
            startedAt,
            endedAt: new Date().toISOString(),
            success: false,
            totalTokens: 0,
            totalCostUsd: 0,
            toolCallCount: 0,
            latencyMs: 0,
            failureReason: (err as Error).message,
          };
          runs[h.name] = failed;
          harnessRuns[h.name]!.push(failed);
        }
      }),
    );
    perTask.push({ task, runs });
  }

  const perHarness: Record<string, HarnessSummary> = {};
  for (const h of opts.harnesses) {
    perHarness[h.name] = summarize(h, harnessRuns[h.name] ?? []);
  }

  return {
    taskCount: opts.tasks.length,
    startedAt,
    endedAt: new Date().toISOString(),
    perHarness,
    perTask,
  };
}

function summarize(h: CompetitorHarness<unknown>, runs: readonly BenchmarkTaskRun[]): HarnessSummary {
  const n = runs.length;
  const successes = runs.filter((r) => r.success).length;
  const totalLatency = runs.reduce((acc, r) => acc + r.latencyMs, 0);
  const totalCost = runs.reduce((acc, r) => acc + r.totalCostUsd, 0);
  const totalTokens = runs.reduce((acc, r) => acc + r.totalTokens, 0);
  const totalToolCalls = runs.reduce((acc, r) => acc + r.toolCallCount, 0);
  return {
    name: h.name,
    version: h.version,
    successRate: n === 0 ? 0 : successes / n,
    avgLatencyMs: n === 0 ? 0 : totalLatency / n,
    totalCostUsd: totalCost,
    totalTokens,
    avgToolCalls: n === 0 ? 0 : totalToolCalls / n,
  };
}
