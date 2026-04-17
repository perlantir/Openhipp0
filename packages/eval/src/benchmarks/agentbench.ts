/**
 * AgentBench adapter.
 *
 * AgentBench tests agents across 8 environments (OS / DB / web-shopping /
 * etc.). Our minimal adapter covers the "output → expected-output" shape
 * common to DB + OS environments: the agent produces a string; we compare
 * against an expected value (exact or regex).
 */

import type { EvalCase } from '../types.js';
import { getCaptures } from '../runner.js';

export interface AgentBenchTask {
  readonly id: string;
  readonly environment: 'os' | 'db' | 'web-shopping' | 'knowledge-graph' | string;
  readonly instruction: string;
  readonly expected: { readonly exact: string } | { readonly pattern: RegExp };
}

export type AgentBenchAgent = (input: {
  readonly instruction: string;
  readonly environment: string;
}) => Promise<{ readonly output: string }>;

export interface AgentBenchLoaderOptions {
  readonly agent: AgentBenchAgent;
  readonly tiers?: readonly ('smoke' | 'regression' | 'full')[];
}

export function taskToCase(
  task: AgentBenchTask,
  opts: AgentBenchLoaderOptions,
): EvalCase<AgentBenchTask, { output: string }> {
  const tiers = opts.tiers ?? ['regression', 'full'];
  return {
    id: `agentbench:${task.id}`,
    name: `AgentBench ${task.environment}: ${task.instruction.slice(0, 40)}`,
    tiers,
    tags: ['agentbench', task.environment],
    setup: () => task,
    async run(ctx) {
      const captures = getCaptures(ctx);
      captures.incToolCalls(1);
      return opts.agent({ instruction: ctx.instruction, environment: ctx.environment });
    },
    verify(result, ctx) {
      const expected = ctx.expected;
      if ('exact' in expected) return result.output.trim() === expected.exact.trim();
      return expected.pattern.test(result.output);
    },
  };
}

export const BUILTIN_AGENTBENCH_TASKS: readonly AgentBenchTask[] = [
  {
    id: 'os-1',
    environment: 'os',
    instruction: 'Print the current hostname',
    expected: { pattern: /[a-zA-Z0-9-]+/ },
  },
  {
    id: 'db-1',
    environment: 'db',
    instruction: 'Count rows in users where active=true',
    expected: { pattern: /^\d+$/ },
  },
];
