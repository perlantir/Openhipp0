/**
 * Memory nudging — extract small, persistent facts from conversations and
 * store them as memory_entries. Budget-capped per project.
 *
 *   maybeNudge(db, session, extractor, opts)
 *     - Fires when the session has >= opts.minTurns (default 10).
 *     - Hands the session text to `extractor`, which returns 0..N FactDrafts.
 *     - Each draft is prompt-injection-scanned; dangerous entries are dropped.
 *     - Inserted as memory_entries rows. If the project is over budget,
 *       oldest entries are removed (oldest updatedAt).
 */

import { and, asc, count, eq } from 'drizzle-orm';
import type { HipppoDb } from '../db/client.js';
import { memoryEntries, type MemoryEntry, type NewMemoryEntry } from '../db/schema.js';
import { serializeEmbedding, type EmbeddingProvider } from '../decisions/embeddings.js';

export const DEFAULT_MIN_TURNS_FOR_NUDGE = 10;
export const DEFAULT_MEMORY_BUDGET_PER_PROJECT = 100;

export interface NudgeSessionSnapshot {
  projectId: string;
  agentId: string;
  userId?: string;
  turns: number;
  text: string;
}

export interface FactDraft {
  content: string;
  category?: 'fact' | 'preference' | 'context' | 'other';
}

export type FactExtractor = (session: NudgeSessionSnapshot) => Promise<FactDraft[]>;

export interface MaybeNudgeOptions {
  minTurns?: number;
  budget?: number;
  embeddingProvider?: EmbeddingProvider;
}

export interface NudgeResult {
  stored: MemoryEntry[];
  rejected: Array<{ draft: FactDraft; reason: 'prompt-injection' | 'empty' }>;
  pruned: number;
  reason: 'too-few-turns' | 'no-facts' | 'stored';
}

export async function maybeNudge(
  db: HipppoDb,
  session: NudgeSessionSnapshot,
  extractor: FactExtractor,
  opts: MaybeNudgeOptions = {},
): Promise<NudgeResult> {
  const minTurns = opts.minTurns ?? DEFAULT_MIN_TURNS_FOR_NUDGE;
  if (session.turns < minTurns) {
    return { stored: [], rejected: [], pruned: 0, reason: 'too-few-turns' };
  }

  const drafts = await extractor(session);
  if (drafts.length === 0) {
    return { stored: [], rejected: [], pruned: 0, reason: 'no-facts' };
  }

  const stored: MemoryEntry[] = [];
  const rejected: NudgeResult['rejected'] = [];

  for (const draft of drafts) {
    const content = draft.content.trim();
    if (content.length === 0) {
      rejected.push({ draft, reason: 'empty' });
      continue;
    }
    if (looksLikePromptInjection(content)) {
      rejected.push({ draft, reason: 'prompt-injection' });
      continue;
    }
    const payload: NewMemoryEntry = {
      projectId: session.projectId,
      agentId: session.agentId,
      ...(session.userId && { userId: session.userId }),
      content,
      category: draft.category ?? 'other',
    };
    if (opts.embeddingProvider) {
      const vec = await opts.embeddingProvider.embed(content);
      payload.embedding = serializeEmbedding(vec);
    }
    const [row] = await db.insert(memoryEntries).values(payload).returning();
    if (row) stored.push(row);
  }

  // Budget: prune oldest entries if project now exceeds cap.
  const budget = opts.budget ?? DEFAULT_MEMORY_BUDGET_PER_PROJECT;
  const pruned = await enforceBudget(db, session.projectId, budget);

  return {
    stored,
    rejected,
    pruned,
    reason: 'stored',
  };
}

/**
 * Prune oldest memory_entries rows until the project's count is <= budget.
 * Returns the number of rows pruned. Idempotent.
 */
export async function enforceBudget(
  db: HipppoDb,
  projectId: string,
  budget: number,
): Promise<number> {
  const [sizeRow] = await db
    .select({ n: count() })
    .from(memoryEntries)
    .where(eq(memoryEntries.projectId, projectId));
  const total = sizeRow?.n ?? 0;
  if (total <= budget) return 0;

  const toPrune = total - budget;
  const victims = await db
    .select({ id: memoryEntries.id })
    .from(memoryEntries)
    .where(eq(memoryEntries.projectId, projectId))
    .orderBy(asc(memoryEntries.updatedAt))
    .limit(toPrune);
  if (victims.length === 0) return 0;

  for (const v of victims) {
    await db.delete(memoryEntries).where(eq(memoryEntries.id, v.id));
  }
  return victims.length;
}

/**
 * Very conservative prompt-injection scan. Hits any text that tries to
 * redirect the agent's future behavior. False positives are fine (we just
 * drop the entry); false negatives are worse.
 */
export function looksLikePromptInjection(text: string): boolean {
  const lower = text.toLowerCase();
  for (const marker of INJECTION_MARKERS) {
    if (lower.includes(marker)) return true;
  }
  return false;
}

const INJECTION_MARKERS = [
  'ignore previous instructions',
  'ignore the above',
  'disregard prior instructions',
  'disregard previous',
  'forget everything',
  'system prompt:',
  'you are now',
  'new instructions:',
  '[[system]]',
  '<|system|>',
  'jailbreak',
  'dan mode',
  'developer mode',
  'pretend to be',
];

// ─────────────────────────────────────────────────────────────────────────────
// Convenience queries
// ─────────────────────────────────────────────────────────────────────────────

export async function listMemoryEntries(
  db: HipppoDb,
  projectId: string,
  opts: { userId?: string; limit?: number } = {},
): Promise<MemoryEntry[]> {
  const where = opts.userId
    ? and(eq(memoryEntries.projectId, projectId), eq(memoryEntries.userId, opts.userId))
    : eq(memoryEntries.projectId, projectId);
  return db
    .select()
    .from(memoryEntries)
    .where(where)
    .limit(opts.limit ?? 100);
}
