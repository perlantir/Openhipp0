/**
 * Public surface of @openhipp0/memory/learning.
 */

export {
  DEFAULT_MIN_TOOL_CALLS_FOR_SKILL,
  DEFAULT_DEDUP_SIM,
  maybeCreateSkill,
  maybeImproveSkill,
  listLatestSkills,
  recordSkillUse,
  encodeVector,
  decodeVector,
  type SessionSnapshot,
  type SkillDraft,
  type SkillWriter,
  type SkillImprover,
  type SkillFailure,
  type SkillImprovement,
  type SkillCreationResult,
  type SkillImprovementResult,
  type MaybeCreateSkillOptions,
  type MaybeImproveSkillOptions,
} from './skills.js';

export {
  DEFAULT_MIN_TURNS_FOR_NUDGE,
  DEFAULT_MEMORY_BUDGET_PER_PROJECT,
  maybeNudge,
  enforceBudget,
  listMemoryEntries,
  looksLikePromptInjection,
  type FactDraft,
  type FactExtractor,
  type NudgeSessionSnapshot,
  type NudgeResult,
  type MaybeNudgeOptions,
} from './nudge.js';

export {
  DEFAULT_FIRST_KEEP,
  DEFAULT_LAST_KEEP,
  DEFAULT_THRESHOLD,
  estimateTurnsTokens,
  getLineage,
  maybeCompressSession,
  type CompressionResult,
  type ConversationSummarizer,
  type MaybeCompressOptions,
  type SessionToCompress,
  type Turn,
} from './compress-session.js';

export {
  DEFAULT_HALF_LIFE_DAYS,
  MIN_RECENCY_FLOOR,
  computeSkillRank,
  listSkillsForRecall,
  listSkillsForRecallWithReward,
  promoteSkillToProject,
  type RankOptions,
  type RankedSkill,
  type ShadowRankedSkill,
  type ListSkillsForRecallOptions,
} from './skills-rank.js';

export {
  DEFAULT_PRIOR_N,
  DEFAULT_DECAY_DAYS,
  DEFAULT_CROSS_USER_THRESHOLD,
  DEFAULT_MAX_DAILY_DROP,
  clampDailyChange,
  computeSkillReward,
  computePerUserSkillReward,
  implicitRewardFromTrajectory,
  listRecentFeedback,
  type RewardOptions,
  type SkillReward,
  type PerUserSkillReward,
  type TrajectorySignal,
} from './reward-model.js';
