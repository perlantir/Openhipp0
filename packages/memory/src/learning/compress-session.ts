/**
 * Conversation compression with lineage.
 *
 * When a session's cumulative token count approaches the LLM context limit,
 * we summarize the middle turns, keep a few anchor turns verbatim (first 2 +
 * last 5 by default), and write a new session_history row whose
 * lineage_parent_id points at the original. The runtime continues from the
 * compressed row.
 *
 * Triggers when estimated tokens cross `thresholdFraction` of the context
 * window (default 70%).
 */

import { eq } from 'drizzle-orm';
import type { HipppoDb } from '../db/client.js';
import { sessionHistory, type NewSessionHistory, type SessionHistory } from '../db/schema.js';

export const DEFAULT_FIRST_KEEP = 2;
export const DEFAULT_LAST_KEEP = 5;
export const DEFAULT_THRESHOLD = 0.7;

/** Minimal turn shape — messages from the runtime fit this. */
export interface Turn {
  role: 'user' | 'assistant' | 'tool' | 'system';
  /** Flat text. Runtime callers should stringify content blocks before passing in. */
  content: string;
}

export interface SessionToCompress {
  projectId: string;
  agentId: string;
  userId?: string;
  turns: readonly Turn[];
  /** Previous session row ID, if any — sets lineage_parent_id. */
  parentSessionId?: string;
  /** Extra fields forwarded verbatim (toolCallsCount, tokensUsed, costUsd). */
  toolCallsCount?: number;
  tokensUsed?: number;
  costUsd?: number;
}

/** Summarizer for middle-of-session turns. Usually wraps an LLM. */
export type ConversationSummarizer = (middleTurns: readonly Turn[]) => Promise<string>;

export interface MaybeCompressOptions {
  /** Fraction of `contextWindowTokens` at which compression kicks in. */
  thresholdFraction?: number;
  /** Context window size in tokens. Default 200k (matches Claude/GPT-4 class). */
  contextWindowTokens?: number;
  firstKeep?: number;
  lastKeep?: number;
}

export interface CompressionResult {
  compressed: SessionHistory | null;
  reason: 'below-threshold' | 'too-few-turns' | 'stored';
  originalTurnCount: number;
  preservedTurnCount: number;
  summaryBytes: number;
}

/**
 * Estimate total tokens for a turn list. chars/4 heuristic (matches the
 * provider-side countTokens).
 */
export function estimateTurnsTokens(turns: readonly Turn[]): number {
  let total = 0;
  for (const t of turns) total += Math.ceil(t.content.length / 4);
  return total;
}

export async function maybeCompressSession(
  db: HipppoDb,
  session: SessionToCompress,
  summarizer: ConversationSummarizer,
  opts: MaybeCompressOptions = {},
): Promise<CompressionResult> {
  const threshold = opts.thresholdFraction ?? DEFAULT_THRESHOLD;
  const contextWindow = opts.contextWindowTokens ?? 200_000;
  const firstKeep = opts.firstKeep ?? DEFAULT_FIRST_KEEP;
  const lastKeep = opts.lastKeep ?? DEFAULT_LAST_KEEP;

  const tokens = estimateTurnsTokens(session.turns);
  if (tokens < threshold * contextWindow) {
    return {
      compressed: null,
      reason: 'below-threshold',
      originalTurnCount: session.turns.length,
      preservedTurnCount: 0,
      summaryBytes: 0,
    };
  }
  if (session.turns.length < firstKeep + lastKeep + 1) {
    return {
      compressed: null,
      reason: 'too-few-turns',
      originalTurnCount: session.turns.length,
      preservedTurnCount: 0,
      summaryBytes: 0,
    };
  }

  const first = session.turns.slice(0, firstKeep);
  const last = session.turns.slice(-lastKeep);
  const middle = session.turns.slice(firstKeep, session.turns.length - lastKeep);

  const summary = await summarizer(middle);

  const fullText = [
    '## Preserved (first turns)',
    ...first.map(serializeTurn),
    '',
    '## Summary of middle turns',
    summary,
    '',
    '## Preserved (last turns)',
    ...last.map(serializeTurn),
  ].join('\n');

  const payload: NewSessionHistory = {
    projectId: session.projectId,
    agentId: session.agentId,
    ...(session.userId && { userId: session.userId }),
    summary,
    fullText,
    toolCallsCount: session.toolCallsCount ?? 0,
    tokensUsed: session.tokensUsed ?? 0,
    costUsd: session.costUsd ?? 0,
    ...(session.parentSessionId && { lineageParentId: session.parentSessionId }),
  };

  const [row] = await db.insert(sessionHistory).values(payload).returning();
  if (!row) throw new Error('maybeCompressSession: insert returned no row');

  return {
    compressed: row,
    reason: 'stored',
    originalTurnCount: session.turns.length,
    preservedTurnCount: first.length + last.length,
    summaryBytes: summary.length,
  };
}

/**
 * Walk the lineage chain for a session, oldest-first. Each row's
 * lineageParentId points to the row it compressed from. Caller-friendly
 * for dashboards that want to show "this conversation was compressed
 * from N prior summaries".
 */
export async function getLineage(
  db: HipppoDb,
  sessionId: string,
  maxDepth = 20,
): Promise<SessionHistory[]> {
  const chain: SessionHistory[] = [];
  let current: string | null = sessionId;
  for (let i = 0; i < maxDepth && current; i++) {
    const [row] = await db
      .select()
      .from(sessionHistory)
      .where(eq(sessionHistory.id, current))
      .limit(1);
    if (!row) break;
    chain.push(row);
    current = row.lineageParentId ?? null;
  }
  chain.reverse();
  return chain;
}

function serializeTurn(t: Turn): string {
  return `- ${t.role}: ${t.content}`;
}
