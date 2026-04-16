/**
 * Cross-session recall over session_history using the FTS5 virtual table.
 *
 * `session_history_fts` mirrors `session_history.full_text` (see the
 * migrate.ts trigger setup). FTS5 MATCH queries are fast, scoring via rank
 * (more negative = more relevant, per FTS5 semantics). We join back to the
 * main table on rowid and preserve FTS rank order.
 *
 * Optional summarization via `SessionSummarizer` — lets callers push recall
 * into a prompt section without the raw SessionHistory rows.
 */

import { and, eq } from 'drizzle-orm';
import type { HipppoDb } from '../db/client.js';
import { sessionHistory, type SessionHistory } from '../db/schema.js';

export interface RecallHit {
  session: SessionHistory;
  /** FTS5 rank (negative; smaller = better). */
  rank: number;
}

export interface RecallOptions {
  agentId?: string;
  userId?: string;
  /** Max hits. Default 10. */
  limit?: number;
}

/**
 * FTS5-backed search. `query` is an FTS5 MATCH expression (tokens or
 * quoted phrases). For user-supplied text, wrap with `escapeFts5`.
 */
export function searchSessions(
  db: HipppoDb,
  projectId: string,
  query: string,
  opts: RecallOptions = {},
): RecallHit[] {
  if (query.trim().length === 0) return [];
  const limit = opts.limit ?? 10;

  // Step 1: FTS5 rowids + rank, best first.
  const ftsRows = db.$client
    .prepare(
      `SELECT rowid, rank FROM session_history_fts
        WHERE session_history_fts MATCH ?
        ORDER BY rank
        LIMIT ?`,
    )
    .all(query, limit * 3) as Array<{ rowid: number; rank: number }>; // overshoot for filtering

  if (ftsRows.length === 0) return [];

  // Step 2: hydrate from session_history by rowid, filtering by project/agent/user.
  const rowids = ftsRows.map((r) => r.rowid);
  const placeholders = rowids.map(() => '?').join(',');
  const filterBind: unknown[] = [...rowids, projectId];
  const extraFilters: string[] = [];
  if (opts.agentId) {
    extraFilters.push('AND agent_id = ?');
    filterBind.push(opts.agentId);
  }
  if (opts.userId) {
    extraFilters.push('AND user_id = ?');
    filterBind.push(opts.userId);
  }

  const rows = db.$client
    .prepare(
      `SELECT rowid AS _rowid, * FROM session_history
        WHERE rowid IN (${placeholders})
          AND project_id = ?
          ${extraFilters.join(' ')}`,
    )
    .all(...filterBind) as Array<Record<string, unknown> & { _rowid: number }>;

  const byRowid = new Map<number, SessionHistory>();
  for (const r of rows) byRowid.set(r._rowid, hydrateSession(r));

  // Step 3: preserve FTS rank order.
  const hits: RecallHit[] = [];
  for (const fts of ftsRows) {
    const row = byRowid.get(fts.rowid);
    if (row) hits.push({ session: row, rank: fts.rank });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Safely quote arbitrary user input as an FTS5 phrase. */
export function escapeFts5(userInput: string): string {
  return `"${userInput.replace(/"/g, '""')}"`;
}

/** Summarizer for turning recall hits into a single prompt snippet. */
export type SessionSummarizer = (hits: readonly RecallHit[]) => Promise<string>;

export async function summarizeRecallHits(
  hits: readonly RecallHit[],
  summarizer: SessionSummarizer,
): Promise<string | null> {
  if (hits.length === 0) return null;
  return summarizer(hits);
}

/** Naive summarizer — concatenates summaries. Deterministic, used in tests. */
export const naiveSessionSummarizer: SessionSummarizer = async (hits) =>
  hits.map((h) => `- ${h.session.summary}`).join('\n');

// ─────────────────────────────────────────────────────────────────────────────
// Recent sessions (no FTS5)
// ─────────────────────────────────────────────────────────────────────────────

export async function listRecentSessions(
  db: HipppoDb,
  projectId: string,
  opts: { limit?: number; agentId?: string; userId?: string } = {},
): Promise<SessionHistory[]> {
  const conds = [eq(sessionHistory.projectId, projectId)];
  if (opts.agentId) conds.push(eq(sessionHistory.agentId, opts.agentId));
  if (opts.userId) conds.push(eq(sessionHistory.userId, opts.userId));

  return db
    .select()
    .from(sessionHistory)
    .where(and(...conds))
    .limit(opts.limit ?? 10);
}

// ─────────────────────────────────────────────────────────────────────────────

function hydrateSession(raw: Record<string, unknown>): SessionHistory {
  const trustRaw = raw.trust as string | null | undefined;
  const trust = trustRaw === 'high' || trustRaw === 'medium' || trustRaw === 'low' || trustRaw === 'untrusted'
    ? trustRaw
    : null;
  return {
    id: String(raw.id),
    projectId: String(raw.project_id),
    agentId: String(raw.agent_id),
    userId: (raw.user_id as string | null) ?? null,
    summary: String(raw.summary),
    fullText: String(raw.full_text),
    toolCallsCount: Number(raw.tool_calls_count ?? 0),
    tokensUsed: Number(raw.tokens_used ?? 0),
    costUsd: Number(raw.cost_usd ?? 0),
    lineageParentId: (raw.lineage_parent_id as string | null) ?? null,
    origin: (raw.origin as string | null) ?? null,
    trust,
    createdAt: String(raw.created_at),
  };
}
