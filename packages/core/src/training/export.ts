/**
 * Trajectory exporters — JSONL, Atropos RL, SFT, DPO.
 */

import type {
  DpoExample,
  SftExample,
  Trajectory,
  TrajectoryMessage,
  TrajectoryOutcome,
} from './types.js';

/** One trajectory per line; each line is a complete JSON object. */
export function toJsonl(trajectories: readonly Trajectory[]): string {
  return trajectories.map((t) => JSON.stringify(t)).join('\n');
}

/** Parse JSONL back into Trajectory[] — useful for re-processing pipelines. */
export function fromJsonl(text: string): Trajectory[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Trajectory);
}

// ─── SFT ─────────────────────────────────────────────────────────────────

export interface ToSftOptions {
  /** Include tool definitions in the example. Default true. */
  includeTools?: boolean;
  /** Drop tool-response content to fit small context windows. Default false. */
  stripToolResults?: boolean;
}

export function toSftExamples(
  trajectories: readonly Trajectory[],
  opts: ToSftOptions = {},
): SftExample[] {
  return trajectories
    .filter((t) => t.outcome === 'success') // SFT defaults to successful rollouts
    .map((t) => ({
      messages: opts.stripToolResults
        ? t.messages.filter((m) => m.role !== 'tool')
        : t.messages,
    }));
}

// ─── DPO ─────────────────────────────────────────────────────────────────

export interface ToDpoOptions {
  /** Pair trajectories by this key (e.g. same task prompt). Default: project+first user message. */
  pairKey?: (t: Trajectory) => string;
}

export function toDpoExamples(
  trajectories: readonly Trajectory[],
  opts: ToDpoOptions = {},
): DpoExample[] {
  const keyFn = opts.pairKey ?? defaultPairKey;
  const buckets = new Map<string, Trajectory[]>();
  for (const t of trajectories) {
    const k = keyFn(t);
    const arr = buckets.get(k) ?? [];
    arr.push(t);
    buckets.set(k, arr);
  }

  const out: DpoExample[] = [];
  for (const group of buckets.values()) {
    const successes = group.filter((t) => t.outcome === 'success');
    const failures = group.filter((t) => t.outcome === 'failure');
    for (const chosen of successes) {
      for (const rejected of failures) {
        const prompt = sharedPrefix(chosen.messages, rejected.messages);
        const chosenNext = chosen.messages[prompt.length];
        const rejectedNext = rejected.messages[prompt.length];
        if (!chosenNext || !rejectedNext) continue;
        const rewardMargin = (chosen.reward ?? 1) - (rejected.reward ?? -1);
        out.push({
          prompt,
          chosen: chosenNext,
          rejected: rejectedNext,
          reward_margin: rewardMargin,
        });
      }
    }
  }
  return out;
}

function defaultPairKey(t: Trajectory): string {
  const firstUser = t.messages.find((m) => m.role === 'user');
  return `${t.projectId}::${firstUser?.content.slice(0, 120) ?? ''}`;
}

function sharedPrefix(
  a: readonly TrajectoryMessage[],
  b: readonly TrajectoryMessage[],
): readonly TrajectoryMessage[] {
  const len = Math.min(a.length, b.length);
  let i = 0;
  for (; i < len; i++) {
    const ai = a[i]!;
    const bi = b[i]!;
    if (ai.role !== bi.role || ai.content !== bi.content) break;
  }
  return a.slice(0, i);
}

// ─── Atropos RL (Nous Research) ──────────────────────────────────────────

/**
 * Atropos-compatible schema (subset). Atropos expects one JSON per trajectory
 * with { observations, actions, rewards, done }. We map messages to
 * observations/actions and derive rewards from outcome.
 */
export interface AtroposStep {
  observation: string;
  action: string;
  reward: number;
  done: boolean;
  metadata?: Record<string, unknown>;
}

export interface AtroposTrajectory {
  id: string;
  steps: AtroposStep[];
  total_reward: number;
  environment: string;
}

export function toAtropos(t: Trajectory, environment = 'hipp0-default'): AtroposTrajectory {
  const steps: AtroposStep[] = [];
  let lastObservation = '';
  for (let i = 0; i < t.messages.length; i++) {
    const m = t.messages[i]!;
    if (m.role === 'user' || m.role === 'system' || m.role === 'tool') {
      // Concatenate context for the next action.
      lastObservation = lastObservation ? `${lastObservation}\n${m.content}` : m.content;
    } else if (m.role === 'assistant') {
      const action = m.content + (m.tool_calls?.length ? `\n<tools>${JSON.stringify(m.tool_calls)}</tools>` : '');
      const isTerminal = i === t.messages.length - 1;
      steps.push({
        observation: lastObservation,
        action,
        reward: isTerminal ? rewardForOutcome(t.outcome, t.reward) : 0,
        done: isTerminal,
      });
      lastObservation = '';
    }
  }
  return {
    id: t.id,
    steps,
    total_reward: rewardForOutcome(t.outcome, t.reward),
    environment,
  };
}

function rewardForOutcome(outcome: TrajectoryOutcome, explicit?: number): number {
  if (typeof explicit === 'number') return explicit;
  if (outcome === 'success') return 1;
  if (outcome === 'failure') return -1;
  if (outcome === 'mixed') return 0.25;
  return 0;
}
