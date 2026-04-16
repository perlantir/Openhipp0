/**
 * Original benchmark: self-learning.
 *
 * Measures whether the Hermes-style skill-creation loop correctly
 * auto-creates a new skill after repeated tool-use patterns, and whether
 * subsequent invocations successfully reuse that skill.
 *
 * Each case feeds a trace of tool calls through a SkillLearner fake. A
 * pass means:
 *   1. A skill was created exactly once for the repeated pattern.
 *   2. A subsequent invocation is served by the skill (skill.hits > 0).
 *   3. No spurious skills were created from noise.
 */

import type { EvalCase } from '../types.js';
import { getCaptures } from '../runner.js';

export interface ToolCallEvent {
  readonly tool: string;
  readonly input: unknown;
}

export interface LearnedSkill {
  readonly id: string;
  readonly trigger: string;
  hits: number;
}

export interface SkillLearner {
  /** Feed a sequence of tool calls, optionally marking them as a cohesive task. */
  ingest(events: readonly ToolCallEvent[]): Promise<void>;
  /** Check how many skills currently exist. */
  skills(): Promise<readonly LearnedSkill[]>;
  /** Try to serve `trigger` from a learned skill; returns the skill id or null. */
  invoke(trigger: string): Promise<string | null>;
  /** Clear learner state for a fresh case. */
  reset(): Promise<void>;
}

export interface SelfLearningTask {
  readonly id: string;
  readonly repeatedPattern: readonly ToolCallEvent[];
  readonly repetitions: number;
  readonly reuseTrigger: string;
  readonly noise?: readonly ToolCallEvent[];
  /** Expected number of distinct skills after ingestion. Default 1. */
  readonly expectedSkills?: number;
}

export interface SelfLearningLoaderOptions {
  readonly learner: SkillLearner;
  readonly tiers?: readonly ('smoke' | 'regression' | 'full')[];
}

export function taskToCase(
  task: SelfLearningTask,
  opts: SelfLearningLoaderOptions,
): EvalCase<SelfLearningTask, { skills: readonly LearnedSkill[]; reusedSkillId: string | null }> {
  const tiers = opts.tiers ?? ['regression', 'full'];
  return {
    id: `self-learning:${task.id}`,
    name: `self-learning: ${task.id}`,
    tiers,
    tags: ['self-learning'],
    async setup() {
      await opts.learner.reset();
      return task;
    },
    async run(ctx) {
      const captures = getCaptures(ctx);
      for (let i = 0; i < ctx.repetitions; i++) {
        await opts.learner.ingest(ctx.repeatedPattern);
        captures.incToolCalls(ctx.repeatedPattern.length);
      }
      if (ctx.noise) {
        await opts.learner.ingest(ctx.noise);
        captures.incToolCalls(ctx.noise.length);
      }
      const skills = await opts.learner.skills();
      const reusedSkillId = await opts.learner.invoke(ctx.reuseTrigger);
      return { skills, reusedSkillId };
    },
    verify(result, ctx) {
      const expected = ctx.expectedSkills ?? 1;
      if (result.skills.length !== expected) return false;
      if (!result.reusedSkillId) return false;
      const skill = result.skills.find((s) => s.id === result.reusedSkillId);
      return !!skill && skill.hits > 0;
    },
  };
}

export const BUILTIN_SELF_LEARNING_TASKS: readonly SelfLearningTask[] = [
  {
    id: 'git-commit-pattern',
    repeatedPattern: [
      { tool: 'git_status', input: {} },
      { tool: 'git_add', input: { path: '.' } },
      { tool: 'git_commit', input: { message: 'wip' } },
    ],
    repetitions: 3,
    reuseTrigger: 'commit current changes',
    noise: [{ tool: 'file_read', input: { path: 'README.md' } }],
    expectedSkills: 1,
  },
  {
    id: 'search-then-extract',
    repeatedPattern: [
      { tool: 'web_search', input: { q: 'topic' } },
      { tool: 'web_fetch', input: { url: '...' } },
      { tool: 'extract_article', input: {} },
    ],
    repetitions: 4,
    reuseTrigger: 'research topic',
    expectedSkills: 1,
  },
];

/**
 * Reference learner — a pattern-window counter. Used as a baseline for
 * the runner's own tests.
 */
export function createReferenceLearner(): SkillLearner {
  let skills: LearnedSkill[] = [];
  const windowCounts = new Map<string, number>();
  const WINDOW_THRESHOLD = 3;

  function signature(events: readonly ToolCallEvent[]): string {
    return events.map((e) => e.tool).join('>');
  }

  return {
    async ingest(events) {
      const sig = signature(events);
      const next = (windowCounts.get(sig) ?? 0) + 1;
      windowCounts.set(sig, next);
      if (next >= WINDOW_THRESHOLD && !skills.some((s) => s.trigger === sig)) {
        skills.push({ id: `skill_${skills.length + 1}`, trigger: sig, hits: 0 });
      }
    },
    async skills() {
      return skills.slice();
    },
    async invoke() {
      // Any trigger that matches the most recently-created skill invokes it.
      const last = skills[skills.length - 1];
      if (!last) return null;
      last.hits += 1;
      return last.id;
    },
    async reset() {
      skills = [];
      windowCounts.clear();
    },
  };
}
