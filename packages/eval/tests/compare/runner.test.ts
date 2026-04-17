import { describe, expect, it } from 'vitest';

import { runComparison } from '../../src/compare/runner.js';
import type { BenchmarkTaskRun, CompetitorHarness } from '../../src/compare/types.js';

const harness = (name: string, successes: boolean[], latencies: number[]): CompetitorHarness<{ id: string }> => {
  let i = 0;
  return {
    name,
    version: '0.0.0',
    async run(task) {
      const idx = i++;
      const ok = successes[idx] ?? false;
      const latency = latencies[idx] ?? 0;
      const run: BenchmarkTaskRun = {
        taskId: task.id,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        success: ok,
        totalTokens: ok ? 100 : 50,
        totalCostUsd: ok ? 0.01 : 0.005,
        toolCallCount: ok ? 2 : 1,
        latencyMs: latency,
      };
      return run;
    },
  };
};

describe('runComparison', () => {
  it('runs every task through every harness and summarizes', async () => {
    const report = await runComparison({
      tasks: [{ id: 't1' }, { id: 't2' }, { id: 't3' }],
      harnesses: [
        harness('openhipp0', [true, true, false], [100, 150, 200]),
        harness('openclaw', [true, false, false], [300, 350, 400]),
      ],
    });
    expect(report.taskCount).toBe(3);
    expect(report.perHarness['openhipp0']!.successRate).toBeCloseTo(2 / 3);
    expect(report.perHarness['openclaw']!.successRate).toBeCloseTo(1 / 3);
    expect(report.perHarness['openhipp0']!.avgLatencyMs).toBe(150);
  });

  it('catches harness errors without aborting the run', async () => {
    const flaky: CompetitorHarness<{ id: string }> = {
      name: 'flaky',
      version: '0',
      async run() {
        throw new Error('boom');
      },
    };
    const report = await runComparison({
      tasks: [{ id: 't1' }],
      harnesses: [flaky],
      taskId: (t) => t.id,
    });
    expect(report.perHarness['flaky']!.successRate).toBe(0);
    const perTask = report.perTask[0]!.runs['flaky']!;
    expect(perTask.success).toBe(false);
    expect(perTask.failureReason).toContain('boom');
  });
});
