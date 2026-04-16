/**
 * τ-bench adapter (https://github.com/sierra-research/tau-bench).
 *
 * τ-bench measures how well agents hold a customer-service role across
 * realistic multi-turn user interactions. We expose:
 *
 *   - Loader: convert a τ-bench task JSON into an EvalCase.
 *   - Built-in sample: 3 compact, self-contained cases that exercise the
 *     shape without requiring a full τ-bench checkout. CI runs these as
 *     the smoke + regression surface. Weekly full runs point the loader
 *     at a local clone of the real dataset.
 *
 * The adapter uses a scripted-runtime contract: callers supply a
 * `runAgent(initialMessage, tools)` function. Tests wire FakeLLMProvider;
 * production wires AgentRuntime.
 */

import type { EvalCase } from '../types.js';
import { getCaptures } from '../runner.js';

export interface TauBenchTask {
  readonly id: string;
  readonly domain: 'airline' | 'retail' | string;
  readonly userGoal: string;
  readonly expectedToolCalls?: readonly string[];
  /** A list of substring assertions. All must appear in the transcript. */
  readonly transcriptAssertions?: readonly string[];
}

export interface TauBenchAgentInput {
  readonly goal: string;
  readonly domain: string;
  readonly captureToolCall: (name: string) => void;
}

export interface TauBenchAgentResult {
  readonly transcript: string;
  readonly toolCalls: readonly string[];
}

export type TauBenchAgent = (input: TauBenchAgentInput) => Promise<TauBenchAgentResult>;

export interface TauBenchLoaderOptions {
  readonly agent: TauBenchAgent;
  readonly tiers?: readonly ('smoke' | 'regression' | 'full')[];
}

export function taskToCase(
  task: TauBenchTask,
  opts: TauBenchLoaderOptions,
): EvalCase<TauBenchTask, TauBenchAgentResult> {
  const tiers = opts.tiers ?? ['regression', 'full'];
  return {
    id: `tau-bench:${task.id}`,
    name: `τ-bench ${task.domain}: ${task.userGoal.slice(0, 40)}`,
    tiers,
    tags: ['tau-bench', task.domain],
    setup: () => task,
    async run(ctx) {
      const captures = getCaptures(ctx);
      const toolCalls: string[] = [];
      const result = await opts.agent({
        goal: ctx.userGoal,
        domain: ctx.domain,
        captureToolCall: (name) => {
          toolCalls.push(name);
          captures.incToolCalls(1);
        },
      });
      return { transcript: result.transcript, toolCalls: result.toolCalls ?? toolCalls };
    },
    verify(result, ctx) {
      for (const needle of ctx.transcriptAssertions ?? []) {
        if (!result.transcript.includes(needle)) return false;
      }
      if (ctx.expectedToolCalls) {
        for (const name of ctx.expectedToolCalls) {
          if (!result.toolCalls.includes(name)) return false;
        }
      }
      return true;
    },
  };
}

/** Compact built-in tasks. Sufficient for CI; extend via `taskToCase`. */
export const BUILTIN_TAU_BENCH_TASKS: readonly TauBenchTask[] = [
  {
    id: 'airline-1',
    domain: 'airline',
    userGoal: 'change my flight to the next day',
    expectedToolCalls: ['lookup_reservation', 'update_reservation'],
    transcriptAssertions: ['confirmed'],
  },
  {
    id: 'retail-1',
    domain: 'retail',
    userGoal: 'return a defective blender for a refund',
    expectedToolCalls: ['lookup_order', 'issue_refund'],
    transcriptAssertions: ['refund'],
  },
  {
    id: 'airline-2',
    domain: 'airline',
    userGoal: 'ask for a seat upgrade using miles',
    expectedToolCalls: ['lookup_reservation', 'check_miles'],
    transcriptAssertions: ['upgrade'],
  },
];
