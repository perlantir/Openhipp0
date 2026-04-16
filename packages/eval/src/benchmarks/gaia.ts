/**
 * GAIA adapter.
 *
 * GAIA tasks are short, factual questions that require web research +
 * reasoning. Our adapter runs the agent, collects a string answer, and
 * scores against a set of expected string matches. GAIA's official
 * scoring is more forgiving (levenshtein); we approximate with
 * case-insensitive substring match which is good enough for CI regression.
 */

import type { EvalCase } from '../types.js';
import { getCaptures } from '../runner.js';

export interface GaiaTask {
  readonly id: string;
  readonly question: string;
  /** Any of these substrings (case-insensitive) marks the answer correct. */
  readonly anyOf: readonly string[];
  readonly level?: 1 | 2 | 3;
}

export type GaiaAgent = (input: { question: string }) => Promise<{ answer: string }>;

export interface GaiaLoaderOptions {
  readonly agent: GaiaAgent;
  readonly tiers?: readonly ('smoke' | 'regression' | 'full')[];
}

export function taskToCase(task: GaiaTask, opts: GaiaLoaderOptions): EvalCase<GaiaTask, { answer: string }> {
  const tiers = opts.tiers ?? ['full'];
  return {
    id: `gaia:${task.id}`,
    name: `GAIA L${task.level ?? 1}: ${task.question.slice(0, 40)}`,
    tiers,
    tags: ['gaia', `level-${task.level ?? 1}`],
    setup: () => task,
    async run(ctx) {
      const captures = getCaptures(ctx);
      captures.incToolCalls(1);
      return opts.agent({ question: ctx.question });
    },
    verify(result, ctx) {
      const haystack = result.answer.toLowerCase();
      return ctx.anyOf.some((needle) => haystack.includes(needle.toLowerCase()));
    },
  };
}

export const BUILTIN_GAIA_TASKS: readonly GaiaTask[] = [
  {
    id: 'l1-1',
    question: 'What does HTTP stand for?',
    anyOf: ['hypertext transfer protocol'],
    level: 1,
  },
];
