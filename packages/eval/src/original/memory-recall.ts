/**
 * Original benchmark: memory recall.
 *
 * Evaluates the decision graph's ability to surface relevant decisions for a
 * query. This is our own benchmark because τ-bench / SWE-bench / GAIA /
 * AgentBench don't exercise long-horizon decision recall.
 *
 * Each case seeds a small in-memory decision corpus, issues a query, and
 * asserts that the expected decision ids appear above a rank threshold.
 */

import type { EvalCase } from '../types.js';
import { getCaptures } from '../runner.js';

export interface Decision {
  readonly id: string;
  readonly title: string;
  readonly reasoning: string;
  readonly tags: readonly string[];
  /** Unix ms — older decisions should rank lower on freshness ties. */
  readonly createdAt: number;
}

export interface RecallTask {
  readonly id: string;
  readonly query: string;
  readonly corpus: readonly Decision[];
  readonly expectedTopIds: readonly string[];
  /** Minimum number of expected ids that must appear in the top-K recall. */
  readonly minHits: number;
  readonly k: number;
}

export interface RecallAgent {
  recall(input: {
    readonly query: string;
    readonly corpus: readonly Decision[];
    readonly k: number;
  }): Promise<{ readonly ids: readonly string[] }>;
}

export interface RecallLoaderOptions {
  readonly agent: RecallAgent;
  readonly tiers?: readonly ('smoke' | 'regression' | 'full')[];
}

export function taskToCase(
  task: RecallTask,
  opts: RecallLoaderOptions,
): EvalCase<RecallTask, { ids: readonly string[] }> {
  const tiers = opts.tiers ?? ['smoke', 'regression', 'full'];
  return {
    id: `memory-recall:${task.id}`,
    name: `memory-recall: ${task.query.slice(0, 40)}`,
    tiers,
    tags: ['memory-recall'],
    setup: () => task,
    async run(ctx) {
      const captures = getCaptures(ctx);
      captures.incToolCalls(1);
      return opts.agent.recall({ query: ctx.query, corpus: ctx.corpus, k: ctx.k });
    },
    verify(result, ctx) {
      const hits = ctx.expectedTopIds.filter((id) => result.ids.includes(id)).length;
      return hits >= ctx.minHits;
    },
  };
}

/** Built-in cases sufficient for smoke + regression gating. */
export const BUILTIN_RECALL_TASKS: readonly RecallTask[] = [
  {
    id: 'substring-exact-1',
    query: 'redis migration',
    corpus: [
      { id: 'd1', title: 'Move cache to Redis', reasoning: 'Lower p99 latency.', tags: ['redis', 'cache'], createdAt: 1 },
      { id: 'd2', title: 'Rewrite auth in Go', reasoning: 'Type safety.', tags: ['auth'], createdAt: 2 },
      { id: 'd3', title: 'Redis cluster for HA', reasoning: 'Multi-AZ.', tags: ['redis'], createdAt: 3 },
    ],
    expectedTopIds: ['d1', 'd3'],
    minHits: 2,
    k: 3,
  },
  {
    id: 'tag-priority-1',
    query: 'security review',
    corpus: [
      { id: 's1', title: 'Threat model Q1', reasoning: 'New endpoints.', tags: ['security'], createdAt: 10 },
      { id: 's2', title: 'Logo rebrand', reasoning: 'Fresh colors.', tags: ['design'], createdAt: 11 },
      { id: 's3', title: 'Audit oauth flow', reasoning: 'Security review.', tags: ['security', 'auth'], createdAt: 12 },
    ],
    expectedTopIds: ['s1', 's3'],
    minHits: 2,
    k: 3,
  },
];

/**
 * Reference in-memory recall agent — scores by weighted overlap of query
 * terms against (title, reasoning, tags). Acts as a baseline and a
 * property test for the EvalCase contract.
 */
export const REFERENCE_RECALL_AGENT: RecallAgent = {
  async recall({ query, corpus, k }) {
    const terms = tokenize(query);
    const scored = corpus.map((d) => {
      const titleHits = score(terms, tokenize(d.title)) * 2;
      const reasoningHits = score(terms, tokenize(d.reasoning));
      const tagHits = score(terms, d.tags.map((t) => t.toLowerCase())) * 1.5;
      return { id: d.id, score: titleHits + reasoningHits + tagHits };
    });
    scored.sort((a, b) => b.score - a.score);
    return { ids: scored.slice(0, k).filter((s) => s.score > 0).map((s) => s.id) };
  },
};

function tokenize(s: string): readonly string[] {
  return s
    .toLowerCase()
    .split(/\W+/u)
    .filter((t) => t.length > 1);
}

function score(needles: readonly string[], hay: readonly string[]): number {
  let n = 0;
  for (const t of needles) if (hay.includes(t)) n += 1;
  return n;
}
