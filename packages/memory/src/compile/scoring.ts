/**
 * Five-signal scoring for decision relevance.
 *
 * Weights (sum to 1.0):
 *   semantic: 0.35   — cosine similarity against the query embedding
 *   tags:     0.20   — Jaccard over normalized tag sets
 *   recency:  0.15   — exp(-age_days / halfLifeDays) with 30-day default
 *   role:     0.15   — does the decision's affects / madeBy match the agent?
 *   outcome:  0.15   — +1 validated, -0.5 refuted, 0 otherwise / missing
 *
 * The spec's reference numbers. Weights are publicly tunable via
 * `ScoringWeights` — deployments with different domain priors can tweak.
 */

import type { Decision, Outcome } from '../db/schema.js';
import { cosineSimilarity, deserializeEmbedding } from '../decisions/embeddings.js';
import { tagSimilarity } from '../decisions/tags.js';

export interface ScoringWeights {
  semantic: number;
  tags: number;
  recency: number;
  role: number;
  outcome: number;
}

export const DEFAULT_WEIGHTS: Readonly<ScoringWeights> = Object.freeze({
  semantic: 0.35,
  tags: 0.2,
  recency: 0.15,
  role: 0.15,
  outcome: 0.15,
});

export interface ScoringContext {
  /** Query embedding. If omitted, the semantic signal is 0 for all. */
  queryEmbedding?: Float32Array;
  /** Query tags (unnormalized OK — tagSimilarity normalizes). */
  queryTags?: readonly string[];
  /** "Now" for recency. Defaults to Date.now(). */
  now?: number;
  /** Recency half-life in days. Default 30. */
  recencyHalfLifeDays?: number;
  /** Agent identity — role signal matches against decision.madeBy / affects. */
  agent?: { id: string; name: string; role: string };
  /** Outcomes keyed by decisionId. Optional; missing ⇒ outcome signal = 0. */
  outcomes?: ReadonlyMap<string, readonly Outcome[]>;
  /** Weight overrides. */
  weights?: Partial<ScoringWeights>;
}

export interface SignalBreakdown {
  semantic: number;
  tags: number;
  recency: number;
  role: number;
  outcome: number;
  total: number;
}

export interface ScoredDecision {
  decision: Decision;
  signals: SignalBreakdown;
}

/** Score a single decision. Exposed for tests / dashboards. */
export function scoreDecision(decision: Decision, ctx: ScoringContext): SignalBreakdown {
  const weights = { ...DEFAULT_WEIGHTS, ...ctx.weights };
  const now = ctx.now ?? Date.now();

  const semantic = semanticSignal(decision, ctx);
  const tags = tagsSignal(decision, ctx);
  const recency = recencySignal(decision, now, ctx.recencyHalfLifeDays ?? 30);
  const role = roleSignal(decision, ctx.agent);
  const outcome = outcomeSignal(decision, ctx.outcomes);

  const total =
    weights.semantic * semantic +
    weights.tags * tags +
    weights.recency * recency +
    weights.role * role +
    weights.outcome * outcome;

  return { semantic, tags, recency, role, outcome, total };
}

/** Score and sort a batch, descending by total. Stable on ties (input order). */
export function scoreAll(decisions: readonly Decision[], ctx: ScoringContext): ScoredDecision[] {
  const indexed = decisions.map((d, i) => ({ d, i, s: scoreDecision(d, ctx) }));
  indexed.sort((a, b) => b.s.total - a.s.total || a.i - b.i);
  return indexed.map((x) => ({ decision: x.d, signals: x.s }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual signals
// ─────────────────────────────────────────────────────────────────────────────

function semanticSignal(decision: Decision, ctx: ScoringContext): number {
  if (!ctx.queryEmbedding || !decision.embedding) return 0;
  try {
    const dv = deserializeEmbedding(decision.embedding);
    const sim = cosineSimilarity(dv, ctx.queryEmbedding);
    // Cosine returns [-1, 1]; clamp to [0, 1] because negative similarity
    // should not "punish" below non-semantic signals — it just means no
    // semantic boost.
    return Math.max(0, sim);
  } catch {
    return 0;
  }
}

function tagsSignal(decision: Decision, ctx: ScoringContext): number {
  if (!ctx.queryTags || ctx.queryTags.length === 0) return 0;
  return tagSimilarity(ctx.queryTags, decision.tags ?? []);
}

function recencySignal(decision: Decision, now: number, halfLifeDays: number): number {
  const created = Date.parse(decision.createdAt);
  if (Number.isNaN(created)) return 0;
  const ageDays = Math.max(0, (now - created) / (1000 * 60 * 60 * 24));
  // Exponential decay with the given half-life. e^(-ln2 * ageDays / halfLife).
  return Math.exp(-(Math.LN2 * ageDays) / Math.max(halfLifeDays, 0.001));
}

function roleSignal(decision: Decision, agent: ScoringContext['agent']): number {
  if (!agent) return 0;
  // 1.0 if the agent made this decision.
  if (decision.madeBy === agent.id) return 1.0;
  // 0.5 if the decision's `affects` list names this agent's id or role.
  const affects = decision.affects ?? [];
  if (affects.some((a) => a === agent.id || a === agent.role || a === agent.name)) {
    return 0.5;
  }
  return 0;
}

function outcomeSignal(decision: Decision, outcomes?: ScoringContext['outcomes']): number {
  if (!outcomes) return 0;
  const list = outcomes.get(decision.id);
  if (!list || list.length === 0) return 0;
  // Last outcome wins — most recent record. Scale to [-0.5, 1].
  const latest = list[list.length - 1]!;
  if (latest.result === 'validated') return 1;
  if (latest.result === 'refuted') return -0.5;
  return 0;
}
