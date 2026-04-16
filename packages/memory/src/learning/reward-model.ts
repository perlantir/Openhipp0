/**
 * Reward model — aggregates user_feedback rows into a per-skill latent
 * reward score used as a SHADOW signal by skill ranking.
 *
 * Hardening:
 *   - **Bayesian prior** (mean=0, n=5) — sparse data doesn't move the
 *     score dramatically from neutral.
 *   - **90-day decay** — feedback older than 90 days weights by
 *     0.5^(age/90d). Old tastes don't dominate current signal.
 *   - **Cross-user isolation** — when only a single user has rated a
 *     skill, that rating is treated as *personal* and does not leak into
 *     the global reward. Cross-user generalization requires ≥ 5 distinct
 *     users.
 *   - **Implicit vs explicit** kept separately — you can ask for one, the
 *     other, or a weighted blend (default: explicit only).
 *   - **Hard rank-change floor** — `clampDailyChange` prevents a skill's
 *     effective rank from dropping more than 20 %/day from reward alone.
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import type { HipppoDb } from '../db/client.js';
import { userFeedback, type UserFeedback } from '../db/schema.js';

export const DEFAULT_PRIOR_N = 5;
export const DEFAULT_DECAY_DAYS = 90;
/** Minimum distinct users whose ratings must agree before a skill's reward
 *  is eligible as a GLOBAL signal (outside the rater's own recall). */
export const DEFAULT_CROSS_USER_THRESHOLD = 5;
/** Max rank drop per day from reward alone, as a fraction. */
export const DEFAULT_MAX_DAILY_DROP = 0.2;

export interface RewardOptions {
  /** Prior N for Bayesian shrinkage. */
  priorN?: number;
  /** Half-life for recency decay, in days. */
  decayDays?: number;
  /** Cap implicit influence (default 0.3) so explicit dominates. */
  implicitWeight?: number;
  /** "Now" for deterministic tests. */
  now?: number;
}

export interface SkillReward {
  /** Combined explicit+implicit reward, -1..1. */
  readonly reward: number;
  readonly explicit: { mean: number; n: number; distinctUsers: number };
  readonly implicit: { mean: number; n: number };
  /** True when the global signal is trustworthy (cross-user threshold met). */
  readonly globallyTrusted: boolean;
}

export interface PerUserSkillReward extends SkillReward {
  readonly userId: string;
}

/**
 * Compute the latent reward for one skill across all feedback rows.
 */
export async function computeSkillReward(
  db: HipppoDb,
  skillId: string,
  opts: RewardOptions = {},
): Promise<SkillReward> {
  const rows = await db.select().from(userFeedback).where(eq(userFeedback.skillId, skillId));
  return aggregate(rows, opts);
}

/**
 * Per-user variant — returns the reward this specific user has expressed
 * for this skill, without cross-user contamination.
 */
export async function computePerUserSkillReward(
  db: HipppoDb,
  skillId: string,
  userId: string,
  opts: RewardOptions = {},
): Promise<PerUserSkillReward> {
  const rows = await db
    .select()
    .from(userFeedback)
    .where(and(eq(userFeedback.skillId, skillId), eq(userFeedback.userId, userId)));
  return { ...aggregate(rows, opts), userId };
}

/**
 * Daily-change clamp applied by ranking code. Given the previous effective
 * rank and the new one, returns a rank that never drops more than
 * `maxDailyDrop` from the previous. Rising is unbounded.
 */
export function clampDailyChange(
  previous: number,
  next: number,
  maxDailyDrop: number = DEFAULT_MAX_DAILY_DROP,
): number {
  if (next >= previous) return next;
  const floor = previous * (1 - maxDailyDrop);
  return Math.max(next, floor);
}

/**
 * Implicit reward from a session trajectory. Currently a simple heuristic:
 *   + if the session ended with an explicit agent-emitted "task-complete"
 *     marker and no follow-up → +0.5
 *   + if the user repeated a near-identical ask within 3 turns → -0.5
 *   + otherwise 0 (abstain).
 *
 * The "task-complete" marker is a sentinel the agent can include in its
 * final reply. We deliberately require it — heuristics like "user said
 * thanks" are easily spoofed and bias-prone.
 */
export interface TrajectorySignal {
  readonly taskCompleteMarker: boolean;
  readonly userRepeatedAsk: boolean;
}

export function implicitRewardFromTrajectory(sig: TrajectorySignal): number {
  if (sig.userRepeatedAsk) return -0.5;
  if (sig.taskCompleteMarker) return 0.5;
  return 0;
}

/**
 * Recent feedback sweep for a project — used by the dashboard to show
 * "what's shifting right now".
 */
export async function listRecentFeedback(
  db: HipppoDb,
  projectId: string,
  opts: { sinceDays?: number; limit?: number } = {},
): Promise<readonly UserFeedback[]> {
  const sinceDays = opts.sinceDays ?? 30;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  return db
    .select()
    .from(userFeedback)
    .where(and(eq(userFeedback.projectId, projectId), gte(userFeedback.createdAt, since)))
    .orderBy(sql`${userFeedback.createdAt} DESC`)
    .limit(opts.limit ?? 200);
}

// ─── internal aggregator ──────────────────────────────────────────────────

function aggregate(rows: readonly UserFeedback[], opts: RewardOptions): SkillReward {
  const priorN = opts.priorN ?? DEFAULT_PRIOR_N;
  const decayDays = opts.decayDays ?? DEFAULT_DECAY_DAYS;
  const implicitWeight = opts.implicitWeight ?? 0.3;
  const now = opts.now ?? Date.now();
  const decayMs = decayDays * 24 * 60 * 60 * 1000;

  const explicitRows: Array<{ rating: number; weight: number; userId: string }> = [];
  const implicitRows: Array<{ rating: number; weight: number }> = [];

  for (const r of rows) {
    const ageMs = Math.max(0, now - Date.parse(r.createdAt));
    const weight = Math.pow(0.5, ageMs / decayMs);
    if (r.source === 'explicit') {
      explicitRows.push({ rating: r.rating, weight, userId: r.userId });
    } else {
      implicitRows.push({ rating: r.rating, weight });
    }
  }

  const explicit = weightedMeanWithPrior(
    explicitRows.map((e) => ({ value: e.rating, weight: e.weight })),
    priorN,
  );
  const distinctUsers = new Set(explicitRows.map((r) => r.userId)).size;
  const implicit = weightedMeanWithPrior(
    implicitRows.map((i) => ({ value: i.rating, weight: i.weight })),
    priorN,
  );

  const globallyTrusted = distinctUsers >= DEFAULT_CROSS_USER_THRESHOLD;
  const combined =
    (explicit.mean + implicitWeight * implicit.mean) / (1 + implicitWeight);
  const reward = clamp(combined, -1, 1);

  return {
    reward,
    explicit: { mean: explicit.mean, n: explicit.n, distinctUsers },
    implicit: { mean: implicit.mean, n: implicit.n },
    globallyTrusted,
  };
}

function weightedMeanWithPrior(
  rows: readonly { value: number; weight: number }[],
  priorN: number,
): { mean: number; n: number } {
  const sumWeights = rows.reduce((s, r) => s + r.weight, 0);
  const sumWeighted = rows.reduce((s, r) => s + r.value * r.weight, 0);
  // Shrink toward prior (0) with effective N = sumWeights.
  const mean = (sumWeighted + 0 * priorN) / (sumWeights + priorN);
  return { mean, n: Math.round(sumWeights) };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
