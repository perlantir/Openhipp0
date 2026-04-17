import { describe, expect, it } from 'vitest';
import { runCase } from '../src/runner.js';
import * as tauBench from '../src/benchmarks/tau-bench.js';
import * as sweBench from '../src/benchmarks/swe-bench.js';
import * as agentBench from '../src/benchmarks/agentbench.js';
import * as gaia from '../src/benchmarks/gaia.js';

describe('tauBench adapter', () => {
  it('passes when transcript + tool-call assertions are met', async () => {
    const c = tauBench.taskToCase(tauBench.BUILTIN_TAU_BENCH_TASKS[0]!, {
      agent: async ({ captureToolCall }) => {
        captureToolCall('lookup_reservation');
        captureToolCall('update_reservation');
        return {
          transcript: 'Your flight has been confirmed for tomorrow.',
          toolCalls: ['lookup_reservation', 'update_reservation'],
        };
      },
    });
    const result = await runCase(c);
    expect(result.metrics.success).toBe(true);
    expect(result.metrics.toolCalls).toBeGreaterThan(0);
  });

  it('fails when a required tool is missing', async () => {
    const c = tauBench.taskToCase(tauBench.BUILTIN_TAU_BENCH_TASKS[0]!, {
      agent: async () => ({ transcript: 'confirmed', toolCalls: ['lookup_reservation'] }),
    });
    const result = await runCase(c);
    expect(result.metrics.success).toBe(false);
  });
});

describe('sweBench adapter', () => {
  it('passes when patched content satisfies the harness', async () => {
    const c = sweBench.taskToCase(sweBench.BUILTIN_SWE_BENCH_TASKS[0]!, {
      agent: async ({ startingFile }) => ({
        patchedContent: startingFile.content.replace(
          'xs.reduce',
          'if (xs == null) return 0; return xs.reduce',
        ),
      }),
    });
    const result = await runCase(c);
    expect(result.metrics.success).toBe(true);
  });

  it('fails when patch does not satisfy harness', async () => {
    const c = sweBench.taskToCase(sweBench.BUILTIN_SWE_BENCH_TASKS[0]!, {
      agent: async ({ startingFile }) => ({ patchedContent: startingFile.content }),
    });
    const result = await runCase(c);
    expect(result.metrics.success).toBe(false);
  });
});

describe('agentBench adapter', () => {
  it('passes on regex-matched output', async () => {
    const c = agentBench.taskToCase(agentBench.BUILTIN_AGENTBENCH_TASKS[1]!, {
      agent: async () => ({ output: '42' }),
    });
    const result = await runCase(c);
    expect(result.metrics.success).toBe(true);
  });

  it('fails on output that does not match', async () => {
    const c = agentBench.taskToCase(agentBench.BUILTIN_AGENTBENCH_TASKS[1]!, {
      agent: async () => ({ output: 'not-a-number' }),
    });
    const result = await runCase(c);
    expect(result.metrics.success).toBe(false);
  });
});

describe('gaia adapter', () => {
  it('case-insensitive substring match', async () => {
    const c = gaia.taskToCase(gaia.BUILTIN_GAIA_TASKS[0]!, {
      agent: async () => ({ answer: 'HyperText Transfer Protocol' }),
    });
    const result = await runCase(c);
    expect(result.metrics.success).toBe(true);
  });
});
