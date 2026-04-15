/**
 * Main compile entry point.
 *
 *   1. Retrieve a generous candidate set (semanticSearch with a large limit).
 *   2. Score all candidates with the 5-signal scorer.
 *   3. Take top N (default 30).
 *   4. Try the requested format; if the estimated tokens exceed the budget,
 *      automatically degrade: markdown → h0c → ultra. Caller can opt out of
 *      auto-degrade to get strict-format behavior.
 *   5. Return one CompiledContextSection (via AgentSystemPromptSection shape).
 */

import type { HipppoDb } from '../db/client.js';
import type { Decision } from '../db/schema.js';
import type { EmbeddingProvider } from '../decisions/embeddings.js';
import { semanticSearch } from '../decisions/query.js';
import type { AgentSystemPromptSection } from './types.js';
import { compressDecisions, estimateTokens, type CompressionFormat } from './compress.js';
import { scoreAll, type ScoringContext } from './scoring.js';

export interface CompileOptions extends Omit<ScoringContext, 'queryEmbedding'> {
  /** Target number of decisions to include after scoring. Default 30. */
  topN?: number;
  /** Initial compression format. Default 'h0c'. */
  format?: CompressionFormat;
  /** Max estimated tokens for the compiled section. Default 2000. */
  tokenBudget?: number;
  /** If true, auto-downgrade format on overflow. Default true. */
  autoDegrade?: boolean;
  /** Candidates to consider pre-scoring. Default 100. */
  candidateLimit?: number;
  /** Minimum semantic similarity to include in candidates. Default 0. */
  minSimilarity?: number;
}

export interface CompileResult {
  sections: AgentSystemPromptSection[];
  /** Metadata surfaced for logging/dashboards. */
  meta: {
    candidatesConsidered: number;
    decisionsIncluded: number;
    formatUsed: CompressionFormat;
    estTokens: number;
    degraded: boolean;
  };
}

/**
 * Compile a relevance-ranked prompt section from the decision graph.
 * `queryText` drives the semantic signal; caller-supplied provider embeds it.
 */
export async function compileContextSection(
  db: HipppoDb,
  projectId: string,
  queryText: string,
  embeddingProvider: EmbeddingProvider,
  opts: CompileOptions = {},
): Promise<CompileResult> {
  const queryEmbedding = await embeddingProvider.embed(queryText);

  const candidates = await semanticSearch(db, projectId, queryText, embeddingProvider, {
    limit: opts.candidateLimit ?? 100,
    minScore: opts.minSimilarity ?? 0,
  });
  const decisionRows: Decision[] = candidates.map((c) => c.decision);

  return compileFromDecisions(decisionRows, queryEmbedding, opts);
}

/**
 * Variant that takes pre-filtered decisions. Useful when the caller has
 * already retrieved them (e.g. when testing, or when a downstream module
 * wants to compile against a specific subset).
 */
export function compileFromDecisions(
  decisions: readonly Decision[],
  queryEmbedding: Float32Array | undefined,
  opts: CompileOptions = {},
): CompileResult {
  const scored = scoreAll(decisions, {
    ...(queryEmbedding && { queryEmbedding }),
    ...(opts.queryTags && { queryTags: opts.queryTags }),
    ...(opts.now !== undefined && { now: opts.now }),
    ...(opts.recencyHalfLifeDays !== undefined && {
      recencyHalfLifeDays: opts.recencyHalfLifeDays,
    }),
    ...(opts.agent && { agent: opts.agent }),
    ...(opts.outcomes && { outcomes: opts.outcomes }),
    ...(opts.weights && { weights: opts.weights }),
  });

  const top = scored.slice(0, opts.topN ?? 30);
  const budget = opts.tokenBudget ?? 2000;
  const autoDegrade = opts.autoDegrade ?? true;
  let format: CompressionFormat = opts.format ?? 'h0c';

  let section = compressDecisions(top, format);
  let degraded = false;
  if (autoDegrade && section.estTokens > budget) {
    if (format === 'markdown') {
      format = 'h0c';
      section = compressDecisions(top, format);
      degraded = true;
    }
    if (section.estTokens > budget && format === 'h0c') {
      format = 'ultra';
      section = compressDecisions(top, format);
      degraded = true;
    }
    // If ultra still overflows, truncate the body at a safe boundary.
    if (section.estTokens > budget) {
      const maxChars = Math.max(0, budget * 4 - 32);
      const truncated = section.body.slice(0, maxChars) + '\n_[truncated to fit budget]_';
      section = {
        ...section,
        body: truncated,
        estTokens: estimateTokens(truncated),
      };
      degraded = true;
    }
  }

  const sections: AgentSystemPromptSection[] =
    top.length === 0 ? [] : [{ title: section.title, body: section.body }];

  return {
    sections,
    meta: {
      candidatesConsidered: decisions.length,
      decisionsIncluded: top.length,
      formatUsed: format,
      estTokens: section.estTokens,
      degraded,
    },
  };
}
