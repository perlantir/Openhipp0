/**
 * SWE-bench Lite adapter.
 *
 * SWE-bench Lite tasks are: given a repo + issue, produce a patch. Our
 * adapter runs the patch against a provided test harness and scores by
 * whether the harness passes after patching.
 *
 * The full dataset needs a repo checkout; this adapter ships a
 * `taskToCase` loader plus two small built-in synthetic tasks that
 * exercise the runner without cloning real repos. The synthetic tasks
 * use a pure-function "harness" (no Docker) that evaluates the patched
 * file content against a boolean assertion.
 */

import type { EvalCase } from '../types.js';
import { getCaptures } from '../runner.js';

export interface SweBenchTask {
  readonly id: string;
  readonly repo: string;
  readonly issue: string;
  readonly startingFile: { readonly path: string; readonly content: string };
  readonly harness: (patched: { readonly path: string; readonly content: string }) => boolean;
}

export interface SweBenchAgentInput {
  readonly issue: string;
  readonly startingFile: { readonly path: string; readonly content: string };
}

export interface SweBenchAgentResult {
  readonly patchedContent: string;
}

export type SweBenchAgent = (input: SweBenchAgentInput) => Promise<SweBenchAgentResult>;

export interface SweBenchLoaderOptions {
  readonly agent: SweBenchAgent;
  readonly tiers?: readonly ('smoke' | 'regression' | 'full')[];
}

export function taskToCase(
  task: SweBenchTask,
  opts: SweBenchLoaderOptions,
): EvalCase<SweBenchTask, SweBenchAgentResult> {
  const tiers = opts.tiers ?? ['regression', 'full'];
  return {
    id: `swe-bench:${task.id}`,
    name: `SWE-bench ${task.repo}: ${task.issue.slice(0, 40)}`,
    tiers,
    tags: ['swe-bench', task.repo],
    setup: () => task,
    async run(ctx) {
      const captures = getCaptures(ctx);
      captures.incToolCalls(1); // file read
      const result = await opts.agent({ issue: ctx.issue, startingFile: ctx.startingFile });
      captures.incToolCalls(1); // file write
      return result;
    },
    verify(result, ctx) {
      return ctx.harness({ path: ctx.startingFile.path, content: result.patchedContent });
    },
  };
}

export const BUILTIN_SWE_BENCH_TASKS: readonly SweBenchTask[] = [
  {
    id: 'null-guard-1',
    repo: 'example/utils',
    issue: 'sum() throws TypeError on null input — should return 0',
    startingFile: {
      path: 'sum.js',
      content: 'export function sum(xs) { return xs.reduce((a, b) => a + b, 0); }',
    },
    harness: ({ content }) =>
      /xs\s*(\?\?|===?)\s*null/.test(content) || /!\s*xs/.test(content),
  },
  {
    id: 'off-by-one-1',
    repo: 'example/ranges',
    issue: 'range(n) returns [0..n-1] but should be [1..n]',
    startingFile: {
      path: 'range.js',
      content:
        'export function range(n) { return Array.from({length:n}, (_,i) => i); }',
    },
    harness: ({ content }) => /i\s*\+\s*1/.test(content) || /length:\s*n.*i\s*\+\s*1/.test(content),
  },
];
