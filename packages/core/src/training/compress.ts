/**
 * Trajectory compression — drop redundant turns while keeping decision-
 * relevant context. The default policy:
 *
 *   1. Always keep the first system message (contains persona + decisions).
 *   2. Always keep the first user message (original task).
 *   3. Keep all tool-call + tool-result pairs (actions and their outcomes).
 *   4. Keep the last assistant turn (final answer).
 *   5. For middle assistant turns, keep only those that contain a tool_call
 *      OR are flagged by `pinTurn` (e.g. turns that modified a decision).
 */

import type { Trajectory, TrajectoryMessage } from './types.js';

export interface CompressOptions {
  /** Target ratio: return <= ratio * original turns. Default 0.5 (50% reduction). */
  targetRatio?: number;
  /** Extra per-turn keep predicate. */
  pinTurn?: (msg: TrajectoryMessage, index: number, source: Trajectory) => boolean;
  /** Max character length for kept tool results. Default: no cap. */
  toolResultMaxChars?: number;
}

export function compressTrajectory(t: Trajectory, opts: CompressOptions = {}): Trajectory {
  const kept = new Set<number>();
  const messages = t.messages;
  const n = messages.length;
  if (n === 0) return t;

  // Rule 1 + 2 + 4.
  for (let i = 0; i < n; i++) {
    const m = messages[i]!;
    if (i === 0 && m.role === 'system') kept.add(i);
    if (m.role === 'user' && ![...kept].some((k) => messages[k]!.role === 'user')) kept.add(i);
  }
  const lastAssistant = lastIndexOf(messages, (m) => m.role === 'assistant');
  if (lastAssistant >= 0) kept.add(lastAssistant);

  // Rule 3: tool_call + tool_result pairs.
  for (let i = 0; i < n; i++) {
    const m = messages[i]!;
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0) {
      kept.add(i);
      const callIds = new Set(m.tool_calls.map((c) => c.id));
      for (let j = i + 1; j < n; j++) {
        const mj = messages[j]!;
        if (mj.role === 'tool' && mj.tool_call_id && callIds.has(mj.tool_call_id)) kept.add(j);
      }
    }
  }

  // Rule 5: custom pins.
  if (opts.pinTurn) {
    for (let i = 0; i < n; i++) {
      if (opts.pinTurn(messages[i]!, i, t)) kept.add(i);
    }
  }

  const targetRatio = opts.targetRatio ?? 0.5;
  const targetCount = Math.ceil(n * targetRatio);
  if (kept.size > targetCount) {
    // Trim older middle turns first while preserving structural invariants.
    const middles = [...kept].sort((a, b) => a - b);
    while (middles.length > targetCount) {
      // Find the middle-most non-anchor turn.
      const anchor = new Set([0, lastAssistant]);
      const dropIdx = middles.findIndex(
        (i) => !anchor.has(i) && messages[i]!.role !== 'system' && messages[i]!.role !== 'user',
      );
      if (dropIdx < 0) break;
      middles.splice(dropIdx, 1);
    }
    kept.clear();
    for (const m of middles) kept.add(m);
  }

  const compressed = messages
    .map((m, i) => (kept.has(i) ? applyToolResultCap(m, opts.toolResultMaxChars) : null))
    .filter((m): m is TrajectoryMessage => m !== null);

  return {
    ...t,
    messages: compressed,
    metadata: {
      ...(t.metadata ?? {}),
      compressed: true,
      originalTurns: n,
      keptTurns: compressed.length,
    },
  };
}

function lastIndexOf<T>(arr: readonly T[], pred: (v: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i;
  return -1;
}

function applyToolResultCap(m: TrajectoryMessage, cap?: number): TrajectoryMessage {
  if (!cap || m.role !== 'tool' || m.content.length <= cap) return m;
  return { ...m, content: `${m.content.slice(0, cap)}…[truncated]` };
}
