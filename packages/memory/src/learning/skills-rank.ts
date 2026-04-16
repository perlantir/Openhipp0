/**
 * Skill ranking — time-based decay + use-count boost so cross-session
 * recall can pick the best skill for the current situation instead of
 * "latest version per agent" (`listLatestSkills`).
 *
 * Score model (deterministic, no randomness):
 *
 *   rank = baseWeight * recency * useBoost * versionBoost
 *
 *   baseWeight    = 1 + successRate              (0.0 → 2.0)
 *   recency       = 0.5 ^ (ageDays / halfLifeDays)   half-life decay
 *   useBoost      = 1 + ln(1 + timesUsed)        log-scale reward
 *   versionBoost  = 1 + 0.1 * timesImproved      small reward per improvement
 *
 * Defaults: halfLifeDays=30 (skills unused for a month weigh half), floor
 * of 0.05 so ancient skills never reach true zero (a deprecated skill
 * should still be findable by an explicit search, just sink in rank).
 *
 * Cross-agent migration:
 *   `listSkillsForRecall(db, projectId)` returns ranked skills for the
 *   whole project, so agent B can surface skills agent A created. Agent-
 *   specific retrieval stays `listLatestSkills`.
 */

import { desc, eq } from 'drizzle-orm';
import type { HipppoDb } from '../db/client.js';
import { skills, type Skill } from '../db/schema.js';
import {
  computeSkillReward,
  DEFAULT_MAX_DAILY_DROP,
  clampDailyChange,
  type RewardOptions,
} from './reward-model.js';

export const DEFAULT_HALF_LIFE_DAYS = 30;
export const MIN_RECENCY_FLOOR = 0.05;

export interface RankOptions {
  /** Half-life for recency decay in days. Default 30. */
  halfLifeDays?: number;
  /** "Now" for deterministic tests. Default: Date.now(). */
  now?: number;
}

export interface RankedSkill {
  readonly skill: Skill;
  readonly rank: number;
  readonly recency: number;
  readonly ageDays: number;
}

/**
 * Compute a decayed rank for a single skill. `updatedAt` is used as the
 * "last touched" timestamp — it auto-bumps on every `recordSkillUse` +
 * `maybeImproveSkill` call, so an unused skill's updatedAt freezes and
 * its recency decays over time.
 */
export function computeSkillRank(skill: Skill, opts: RankOptions = {}): RankedSkill {
  const halfLife = (opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS) * 24 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now();
  const updatedAtMs = Date.parse(skill.updatedAt);
  const ageMs = Math.max(0, now - updatedAtMs);
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  const recency = Math.max(MIN_RECENCY_FLOOR, Math.pow(0.5, ageMs / halfLife));

  const baseWeight = 1 + skill.successRate; // 1.0 .. 2.0
  const useBoost = 1 + Math.log(1 + skill.timesUsed);
  const versionBoost = 1 + 0.1 * skill.timesImproved;

  const rank = baseWeight * recency * useBoost * versionBoost;
  return { skill, rank, recency, ageDays };
}

export interface ListSkillsForRecallOptions extends RankOptions {
  /** Filter to skills matching the current query (heuristic prefix scan on title + triggerPattern). */
  query?: string;
  /** Max skills returned. Default 10. */
  limit?: number;
  /** Minimum rank cutoff. Skills below this drop off the result. Default 0. */
  minRank?: number;
  /** Restrict to a single agent. When omitted, all agents in the project are considered. */
  agentId?: string;
}

/**
 * List project-wide skills ranked by decayed score. Top rank first. Skips
 * non-latest versions (a parent row of an improved skill shouldn't outrank
 * its successor).
 */
export async function listSkillsForRecall(
  db: HipppoDb,
  projectId: string,
  opts: ListSkillsForRecallOptions = {},
): Promise<RankedSkill[]> {
  const rows = await db
    .select()
    .from(skills)
    .where(eq(skills.projectId, projectId))
    .orderBy(desc(skills.updatedAt));

  // Drop parents whose child exists (version chain: parent.id = child.parentVersionId).
  const childOf = new Set<string>();
  for (const r of rows) {
    if (r.parentVersionId) childOf.add(r.parentVersionId);
  }
  const latest = rows.filter((r) => !childOf.has(r.id));

  const filteredByAgent = opts.agentId ? latest.filter((r) => r.agentId === opts.agentId) : latest;

  const q = (opts.query ?? '').trim().toLowerCase();
  const matchesQuery = (s: Skill): boolean => {
    if (!q) return true;
    if (s.title.toLowerCase().includes(q)) return true;
    if (s.triggerPattern && s.triggerPattern.toLowerCase().includes(q)) return true;
    return false;
  };

  const ranked: RankedSkill[] = filteredByAgent
    .filter(matchesQuery)
    .map((s) => computeSkillRank(s, opts));

  const cutoff = opts.minRank ?? 0;
  ranked.sort((a, b) => b.rank - a.rank);
  const limited = ranked.filter((r) => r.rank >= cutoff).slice(0, opts.limit ?? 10);
  return limited;
}

/**
 * Reward-weighted shadow rank. Runs ALONGSIDE `listSkillsForRecall` — it
 * does NOT replace the primary signal. Promotion to primary should be
 * gated on a holdout set showing improvement.
 *
 * Formula:
 *   shadowRank = rank × (1 + 0.5 × reward)   // reward ∈ [-1, 1]
 *   subject to: shadowRank never drops more than 20 % below the primary
 *               rank in a single day (clampDailyChange).
 *
 * If a skill has no feedback, the reward defaults to 0 (Bayesian prior) —
 * so shadow rank = primary rank. This makes the shadow a superset:
 * everything in primary is also in shadow, possibly re-ordered.
 */
export interface ShadowRankedSkill extends RankedSkill {
  readonly shadowRank: number;
  readonly reward: number;
  readonly globallyTrusted: boolean;
}

export async function listSkillsForRecallWithReward(
  db: HipppoDb,
  projectId: string,
  opts: ListSkillsForRecallOptions & { maxDailyDrop?: number } & RewardOptions = {},
): Promise<ShadowRankedSkill[]> {
  const base = await listSkillsForRecall(db, projectId, opts);
  const withReward: ShadowRankedSkill[] = [];
  for (const r of base) {
    const rewardInfo = await computeSkillReward(db, r.skill.id, opts);
    // Only apply global reward when trust threshold met — otherwise the
    // shadow score equals the primary rank.
    const effectiveReward = rewardInfo.globallyTrusted ? rewardInfo.reward : 0;
    const raw = r.rank * (1 + 0.5 * effectiveReward);
    const shadow = clampDailyChange(r.rank, raw, opts.maxDailyDrop ?? DEFAULT_MAX_DAILY_DROP);
    withReward.push({
      ...r,
      reward: effectiveReward,
      shadowRank: shadow,
      globallyTrusted: rewardInfo.globallyTrusted,
    });
  }
  withReward.sort((a, b) => b.shadowRank - a.shadowRank);
  return withReward;
}

/**
 * "Promote" — mark a skill as project-wide usable by copying it under a
 * synthetic project-level agent id (`*project`). Used when one agent
 * consistently uses the skill successfully and ops wants other agents in
 * the project to discover it.
 *
 * This is a structural copy (new row, new id, parentVersionId=source.id)
 * so metrics on the project-wide copy track independently from the
 * per-agent original.
 */
export async function promoteSkillToProject(
  db: HipppoDb,
  sourceId: string,
): Promise<Skill | null> {
  const [src] = await db.select().from(skills).where(eq(skills.id, sourceId)).limit(1);
  if (!src) return null;

  const payload = {
    projectId: src.projectId,
    agentId: '*project' as const,
    title: src.title,
    contentMd: src.contentMd,
    ...(src.triggerPattern && { triggerPattern: src.triggerPattern }),
    autoGenerated: src.autoGenerated,
    version: 1,
    parentVersionId: src.id,
  };
  const [row] = await db.insert(skills).values(payload).returning();
  return row ?? null;
}
