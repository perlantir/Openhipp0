/**
 * Decision queries.
 *
 * Three primitives:
 *   - listByProject        — paginated read filtered by status.
 *   - semanticSearch       — cosine similarity over embeddings. Full-table
 *                            scan in SQLite (no ANN index); fine up to ~50k
 *                            rows. Postgres+pgvector will use a proper
 *                            HNSW index in Phase 2.x.
 *   - filterByTags         — Jaccard overlap on normalized tag sets.
 *
 * The context compiler (packages/memory/src/compile/) consumes these plus a
 * recency signal and a role signal to produce the final 5-signal score.
 */

import { and, desc, eq } from 'drizzle-orm';
import type { HipppoDb } from '../db/client.js';
import { decisions, type Decision } from '../db/schema.js';
import { cosineSimilarity, deserializeEmbedding, type EmbeddingProvider } from './embeddings.js';
import { tagSimilarity } from './tags.js';

export type DecisionStatus = Decision['status'];

// ─────────────────────────────────────────────────────────────────────────────

export interface ListByProjectOptions {
  status?: DecisionStatus;
  limit?: number;
  offset?: number;
}

/** Paginated list, newest-first by createdAt. */
export async function listByProject(
  db: HipppoDb,
  projectId: string,
  opts: ListByProjectOptions = {},
): Promise<Decision[]> {
  const where = opts.status
    ? and(eq(decisions.projectId, projectId), eq(decisions.status, opts.status))
    : eq(decisions.projectId, projectId);

  return db
    .select()
    .from(decisions)
    .where(where)
    .orderBy(desc(decisions.createdAt))
    .limit(opts.limit ?? 50)
    .offset(opts.offset ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface SemanticHit {
  decision: Decision;
  /** cosine similarity in [-1, 1]; higher is more similar. */
  score: number;
}

export interface SemanticSearchOptions {
  limit?: number;
  /** Only return hits at or above this score. Default: 0 (keep everything). */
  minScore?: number;
  /** Restrict to active decisions by default. Pass null to include all. */
  status?: DecisionStatus | null;
}

/**
 * Full-scan cosine similarity. Callers supply an already-embedded query
 * vector (produced by the same provider used when decisions were written).
 */
export function semanticSearchByVector(
  db: HipppoDb,
  projectId: string,
  queryVector: Float32Array,
  opts: SemanticSearchOptions = {},
): SemanticHit[] {
  const where =
    opts.status === null
      ? eq(decisions.projectId, projectId)
      : and(eq(decisions.projectId, projectId), eq(decisions.status, opts.status ?? 'active'));

  // Drizzle's sync API for better-sqlite3 is preferred here — semantic search
  // is already O(N * dim); one sync pass is fastest.
  const rows = db.select().from(decisions).where(where).all();

  const hits: SemanticHit[] = [];
  for (const row of rows) {
    if (!row.embedding) continue;
    let score: number;
    try {
      score = cosineSimilarity(deserializeEmbedding(row.embedding), queryVector);
    } catch {
      continue; // skip rows with malformed embeddings rather than failing the whole query
    }
    if (score >= (opts.minScore ?? 0)) hits.push({ decision: row, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, opts.limit ?? 20);
}

/** Convenience: embed `queryText` with the provider, then search. */
export async function semanticSearch(
  db: HipppoDb,
  projectId: string,
  queryText: string,
  provider: EmbeddingProvider,
  opts: SemanticSearchOptions = {},
): Promise<SemanticHit[]> {
  const vec = await provider.embed(queryText);
  return semanticSearchByVector(db, projectId, vec, opts);
}

// ─────────────────────────────────────────────────────────────────────────────

export interface TagHit {
  decision: Decision;
  /** Jaccard similarity over normalized tags; 0..1. */
  score: number;
}

export interface FilterByTagsOptions {
  limit?: number;
  minScore?: number;
  status?: DecisionStatus | null;
}

/**
 * Tag-similarity search. Full-scan — cheap for small N. Also used by the
 * compiler as one of the 5 scoring signals.
 */
export function filterByTags(
  db: HipppoDb,
  projectId: string,
  queryTags: readonly string[],
  opts: FilterByTagsOptions = {},
): TagHit[] {
  const where =
    opts.status === null
      ? eq(decisions.projectId, projectId)
      : and(eq(decisions.projectId, projectId), eq(decisions.status, opts.status ?? 'active'));

  const rows = db.select().from(decisions).where(where).all();

  const hits: TagHit[] = [];
  for (const row of rows) {
    const score = tagSimilarity(queryTags, row.tags ?? []);
    if (score >= (opts.minScore ?? 0)) hits.push({ decision: row, score });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, opts.limit ?? 20);
}
