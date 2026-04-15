/**
 * Decision CRUD.
 *
 * Embeddings are generated asynchronously — `createDecision` can either:
 *   - generate + store the embedding inline (default; waits on the provider)
 *   - skip (for bulk insert paths that backfill embeddings later)
 *
 * Tags are normalized with `normalizeTags` before storage, so querying by
 * tag is always against the normalized form.
 *
 * Superseding is explicit: `supersedeDecision(old, new)` marks the old
 * decision's status='superseded' + supersededBy=new.id, and writes a
 * 'supersedes' edge. Keeps graph traversal consistent.
 */

import { eq } from 'drizzle-orm';
import type { HipppoDb } from '../db/client.js';
import { decisions, type Decision, type NewDecision } from '../db/schema.js';
import { insertEdge } from './edges.js';
import { deserializeEmbedding, serializeEmbedding, type EmbeddingProvider } from './embeddings.js';
import { normalizeTags } from './tags.js';

export interface CreateDecisionInput {
  projectId: string;
  title: string;
  reasoning: string;
  madeBy: string;
  affects?: readonly string[];
  confidence: 'high' | 'medium' | 'low';
  tags?: readonly string[];
}

export interface CreateDecisionOptions {
  /** If provided, embeds `title + "\n" + reasoning` and stores the vector inline. */
  embeddingProvider?: EmbeddingProvider;
  /** Skip embedding even if a provider is configured. Useful for bulk import. */
  skipEmbedding?: boolean;
}

/** Insert a new decision. Returns the persisted row. */
export async function createDecision(
  db: HipppoDb,
  input: CreateDecisionInput,
  opts: CreateDecisionOptions = {},
): Promise<Decision> {
  const normalizedTags = normalizeTags(input.tags ?? []);

  const payload: NewDecision = {
    projectId: input.projectId,
    title: input.title,
    reasoning: input.reasoning,
    madeBy: input.madeBy,
    affects: [...(input.affects ?? [])],
    confidence: input.confidence,
    tags: normalizedTags,
  };

  if (opts.embeddingProvider && !opts.skipEmbedding) {
    const vec = await opts.embeddingProvider.embed(embeddingInput(input.title, input.reasoning));
    payload.embedding = serializeEmbedding(vec);
  }

  const [row] = await db.insert(decisions).values(payload).returning();
  if (!row) throw new Error('createDecision: insert returned no row');
  return row;
}

export async function getDecision(db: HipppoDb, id: string): Promise<Decision | undefined> {
  const rows = await db.select().from(decisions).where(eq(decisions.id, id)).limit(1);
  return rows[0];
}

export interface UpdateDecisionInput {
  title?: string;
  reasoning?: string;
  affects?: readonly string[];
  confidence?: 'high' | 'medium' | 'low';
  tags?: readonly string[];
  status?: 'active' | 'superseded' | 'rejected';
  supersededBy?: string | null;
}

export async function updateDecision(
  db: HipppoDb,
  id: string,
  changes: UpdateDecisionInput,
  opts: CreateDecisionOptions = {},
): Promise<Decision | undefined> {
  const patch: Partial<NewDecision> = {};
  if (changes.title !== undefined) patch.title = changes.title;
  if (changes.reasoning !== undefined) patch.reasoning = changes.reasoning;
  if (changes.affects !== undefined) patch.affects = [...changes.affects];
  if (changes.confidence !== undefined) patch.confidence = changes.confidence;
  if (changes.tags !== undefined) patch.tags = normalizeTags(changes.tags);
  if (changes.status !== undefined) patch.status = changes.status;
  if (changes.supersededBy !== undefined) patch.supersededBy = changes.supersededBy;

  // Re-embed if title or reasoning changed.
  const touchedEmbedding =
    (changes.title !== undefined || changes.reasoning !== undefined) &&
    opts.embeddingProvider &&
    !opts.skipEmbedding;

  if (touchedEmbedding) {
    const current = await getDecision(db, id);
    if (current) {
      const title = changes.title ?? current.title;
      const reasoning = changes.reasoning ?? current.reasoning;
      const vec = await opts.embeddingProvider!.embed(embeddingInput(title, reasoning));
      patch.embedding = serializeEmbedding(vec);
    }
  }

  if (Object.keys(patch).length === 0) return getDecision(db, id);
  const [row] = await db.update(decisions).set(patch).where(eq(decisions.id, id)).returning();
  return row;
}

/**
 * Mark `oldId` as superseded by `newId` + create a 'supersedes' edge from
 * the new decision to the old. Idempotent — running twice is a no-op.
 */
export async function supersedeDecision(db: HipppoDb, oldId: string, newId: string): Promise<void> {
  const [old] = await db.select().from(decisions).where(eq(decisions.id, oldId)).limit(1);
  if (!old) throw new Error(`supersedeDecision: old decision not found: ${oldId}`);
  if (old.status === 'superseded' && old.supersededBy === newId) return;

  await db
    .update(decisions)
    .set({ status: 'superseded', supersededBy: newId })
    .where(eq(decisions.id, oldId));

  await insertEdge(db, {
    sourceId: newId,
    targetId: oldId,
    relationship: 'supersedes',
    weight: 1.0,
  });
}

/** Hard-delete a decision. Cascades to edges + outcomes via FK. */
export async function deleteDecision(db: HipppoDb, id: string): Promise<boolean> {
  const res = await db
    .delete(decisions)
    .where(eq(decisions.id, id))
    .returning({ id: decisions.id });
  return res.length > 0;
}

/** Extract the stored embedding as a Float32Array (or null if not set). */
export function decodeEmbedding(row: Pick<Decision, 'embedding'>): Float32Array | null {
  return row.embedding ? deserializeEmbedding(row.embedding) : null;
}

function embeddingInput(title: string, reasoning: string): string {
  return `${title}\n${reasoning}`;
}
