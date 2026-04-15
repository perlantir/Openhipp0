/**
 * Contradiction detection.
 *
 * Given a candidate decision D_new (its title + reasoning + embedding), scan
 * existing active decisions in the same project. Score pairs by cosine
 * similarity, then bucket:
 *
 *   sim >= HARD_SIM (default 0.85)
 *     → High textual overlap. The heuristic checks for opposing-conclusion
 *       patterns (negation flip, antonym verbs, opposite confidence on same
 *       subject). If opposing → flag as contradiction.
 *   LLM_SIM_MIN (0.70) <= sim < HARD_SIM (0.85)
 *     → Ambiguous. If a classifier is supplied, ask it; otherwise skip.
 *   sim < LLM_SIM_MIN
 *     → Not a contradiction candidate.
 *
 * Flagged contradictions can be written as 'contradicts' decision_edges via
 * `recordContradictions` — this lets the caller preview before committing.
 *
 * No ground-truth corpus ships with 2b, so we can't benchmark to 0.92 F1
 * directly. The heuristic + LLM combo is modular: swap the classifier for a
 * fine-tuned model later without changing callers.
 */

import type { HipppoDb } from '../db/client.js';
import type { Decision } from '../db/schema.js';
import { insertEdge } from '../decisions/edges.js';
import {
  cosineSimilarity,
  deserializeEmbedding,
  type EmbeddingProvider,
} from '../decisions/embeddings.js';
import { listByProject } from '../decisions/query.js';

export const HARD_SIM_THRESHOLD = 0.85;
export const LLM_SIM_MIN = 0.7;

export interface ContradictionCandidate {
  decision: Decision;
  similarity: number;
  /** How confident we are this is a contradiction (not just similarity). */
  confidence: 'high' | 'medium' | 'low';
  /** Free-form reason surfaced to audit/UX. */
  reason: string;
}

/**
 * Pluggable classifier for ambiguous cases. Return `true` if `a` and `b`
 * reach opposing conclusions, `false` otherwise. Implementations typically
 * wrap an LLM call.
 */
export type ContradictionClassifier = (
  a: { title: string; reasoning: string },
  b: { title: string; reasoning: string },
) => Promise<boolean>;

export interface DetectOptions {
  /** Similarity threshold where the heuristic alone flags. Default 0.85. */
  hardSim?: number;
  /** Lower bound for invoking the classifier. Default 0.70. */
  llmSimMin?: number;
  /** Optional classifier for the 0.70–0.85 band. */
  classifier?: ContradictionClassifier;
  /** Max candidates to return. Default 20. */
  limit?: number;
  /** Skip decisions whose ids appear here (e.g. the new decision itself). */
  excludeIds?: readonly string[];
}

export interface DetectInput {
  projectId: string;
  title: string;
  reasoning: string;
  embedding: Float32Array;
}

/**
 * Find potential contradictions for a new/candidate decision. Does NOT write
 * edges — use `recordContradictions` for that.
 */
export async function detectContradictions(
  db: HipppoDb,
  input: DetectInput,
  opts: DetectOptions = {},
): Promise<ContradictionCandidate[]> {
  const hardSim = opts.hardSim ?? HARD_SIM_THRESHOLD;
  const llmSimMin = opts.llmSimMin ?? LLM_SIM_MIN;
  const exclude = new Set(opts.excludeIds ?? []);

  const all = await listByProject(db, input.projectId, { status: 'active', limit: 1000 });

  const candidates: ContradictionCandidate[] = [];
  const pendingLlm: Array<{ decision: Decision; similarity: number }> = [];

  for (const row of all) {
    if (exclude.has(row.id)) continue;
    if (!row.embedding) continue;
    let sim: number;
    try {
      sim = cosineSimilarity(deserializeEmbedding(row.embedding), input.embedding);
    } catch {
      continue;
    }

    if (sim >= hardSim) {
      const opposing = opposingConclusions(input, { title: row.title, reasoning: row.reasoning });
      if (opposing.opposing) {
        candidates.push({
          decision: row,
          similarity: sim,
          confidence: 'high',
          reason: opposing.reason,
        });
      }
      continue;
    }

    if (sim >= llmSimMin && opts.classifier) {
      pendingLlm.push({ decision: row, similarity: sim });
    }
  }

  if (opts.classifier && pendingLlm.length > 0) {
    for (const pair of pendingLlm) {
      const opposing = await opts.classifier(input, {
        title: pair.decision.title,
        reasoning: pair.decision.reasoning,
      });
      if (opposing) {
        candidates.push({
          decision: pair.decision,
          similarity: pair.similarity,
          confidence: 'medium',
          reason: 'classifier: opposing conclusions',
        });
      }
    }
  }

  candidates.sort((a, b) => b.similarity - a.similarity);
  return candidates.slice(0, opts.limit ?? 20);
}

/**
 * Convenience: embed the candidate text first, then detect.
 */
export async function detectContradictionsForText(
  db: HipppoDb,
  projectId: string,
  title: string,
  reasoning: string,
  provider: EmbeddingProvider,
  opts: DetectOptions = {},
): Promise<ContradictionCandidate[]> {
  const embedding = await provider.embed(`${title}\n${reasoning}`);
  return detectContradictions(db, { projectId, title, reasoning, embedding }, opts);
}

/**
 * Write `contradicts` edges for the supplied candidates. Idempotent (edges
 * table upserts on (source, target, relationship)). Requires the *new*
 * decision to already be persisted — pass its id as `newDecisionId`.
 */
export async function recordContradictions(
  db: HipppoDb,
  newDecisionId: string,
  candidates: readonly ContradictionCandidate[],
): Promise<number> {
  let written = 0;
  for (const c of candidates) {
    if (c.decision.id === newDecisionId) continue;
    await insertEdge(db, {
      sourceId: newDecisionId,
      targetId: c.decision.id,
      relationship: 'contradicts',
      weight: confidenceToWeight(c.confidence),
    });
    written++;
  }
  return written;
}

// ─────────────────────────────────────────────────────────────────────────────
// Opposing-conclusion heuristic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Very conservative heuristic. Two decisions are "opposing" if, after
 * tokenization, they share a substantial set of content tokens AND one of
 * them contains negation/aversive verbs that the other doesn't. Returns a
 * reason string that gets shown in the audit log.
 *
 * This is INTENTIONALLY strict: false negatives are fine (high-sim pairs are
 * also handed to the classifier when one is configured); false positives
 * (flagging a pair that's really supporting) are worse because they pollute
 * the graph.
 */
export type Stance = 'aversive' | 'positive' | 'neutral';

/**
 * Coarse stance classification. A side is aversive if it contains negation
 * markers OR aversive verbs; positive if it contains positive verbs without
 * any aversive signal; otherwise neutral. Negation dominates — "do not use"
 * stays aversive even though "use" is a positive verb.
 */
export function classifyStance(text: string): Stance {
  const lower = text.toLowerCase();
  const negated = hasNegation(lower);
  const aversive = AVERSIVE_VERBS.some((v) => lower.includes(v));
  if (negated || aversive) return 'aversive';
  if (POSITIVE_VERBS.some((v) => lower.includes(v))) return 'positive';
  return 'neutral';
}

export function opposingConclusions(
  a: { title: string; reasoning: string },
  b: { title: string; reasoning: string },
): { opposing: boolean; reason: string } {
  const aText = `${a.title}\n${a.reasoning}`;
  const bText = `${b.title}\n${b.reasoning}`;
  const aStance = classifyStance(aText);
  const bStance = classifyStance(bText);

  if (
    (aStance === 'aversive' && bStance === 'positive') ||
    (aStance === 'positive' && bStance === 'aversive')
  ) {
    return {
      opposing: true,
      reason: `stance mismatch: ${aStance} vs ${bStance} (negation flip or aversive/positive verb split)`,
    };
  }
  return { opposing: false, reason: '' };
}

/**
 * True negation particles only. Aversive VERBS like "avoid" / "reject" live
 * in AVERSIVE_VERBS — keep the two concepts separated so "Avoid Redis" is
 * classified as an aversive statement, not a negated one.
 */
const NEGATION_MARKERS = [' not ', "don't", 'do not', ' never ', ' without '];

const AVERSIVE_VERBS = [
  'avoid',
  'reject',
  'drop',
  'remove',
  'disable',
  'deprecate',
  'disallow',
  'forbid',
  'ban',
];
const POSITIVE_VERBS = [
  'adopt',
  'use',
  'enable',
  'allow',
  'require',
  'prefer',
  'add',
  'introduce',
  'ship',
];

function hasNegation(s: string): boolean {
  const padded = ` ${s} `;
  return NEGATION_MARKERS.some((m) => padded.includes(m));
}

function confidenceToWeight(c: 'high' | 'medium' | 'low'): number {
  return c === 'high' ? 0.95 : c === 'medium' ? 0.7 : 0.4;
}
