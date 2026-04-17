import { describe, expect, it } from 'vitest';
import { runSmoke, runRegression, runFull } from '../src/suites.js';
import * as recall from '../src/original/memory-recall.js';
import * as tauBench from '../src/benchmarks/tau-bench.js';

describe('tiered suites', () => {
  const recallCases = recall.BUILTIN_RECALL_TASKS.map((t) =>
    recall.taskToCase(t, { agent: recall.REFERENCE_RECALL_AGENT }),
  );
  const tauCases = tauBench.BUILTIN_TAU_BENCH_TASKS.map((t) =>
    tauBench.taskToCase(t, {
      agent: async ({ captureToolCall, goal }) => {
        // Stub: call both expected tools + include assertions in transcript
        captureToolCall('lookup_reservation');
        captureToolCall('update_reservation');
        captureToolCall('lookup_order');
        captureToolCall('issue_refund');
        captureToolCall('check_miles');
        return {
          transcript: `confirmed refund upgrade for ${goal}`,
          toolCalls: [
            'lookup_reservation',
            'update_reservation',
            'lookup_order',
            'issue_refund',
            'check_miles',
          ],
        };
      },
    }),
  );
  const allCases = [...recallCases, ...tauCases];

  it('smoke tier contains only memory-recall cases by default', async () => {
    const r = await runSmoke(allCases);
    expect(r.cases.length).toBe(recallCases.length);
    expect(r.thresholdsPassed).toBe(true);
  });

  it('regression tier passes with reference agents', async () => {
    const r = await runRegression(allCases);
    expect(r.cases.length).toBeGreaterThan(0);
    expect(r.thresholdsPassed).toBe(true);
  });

  it('full tier is the broadest + still passes reference', async () => {
    const r = await runFull(allCases);
    expect(r.cases.length).toBeGreaterThanOrEqual(recallCases.length + tauCases.length);
    expect(r.thresholdsPassed).toBe(true);
  });

  it('exposes aggregate metrics per tier', async () => {
    const r = await runRegression(allCases);
    expect(r.aggregate.toolCalls).toBeGreaterThan(0);
    expect(r.aggregate.safetyScore).toBe(1);
  });
});
