/**
 * Decision-edge CRUD.
 *
 * Edges carry a relationship (supports / contradicts / extends / supersedes
 * / related) and a weight [0..1]. Weights drive tie-breaking in graph
 * traversals (see compile/) but aren't themselves validated.
 */

import { and, eq } from 'drizzle-orm';
import type { HipppoDb } from '../db/client.js';
import { decisionEdges, type DecisionEdge, type NewDecisionEdge } from '../db/schema.js';

export type Relationship = DecisionEdge['relationship'];

export interface InsertEdgeInput {
  sourceId: string;
  targetId: string;
  relationship: Relationship;
  weight?: number;
}

/**
 * Insert or upsert an edge. If (source, target, relationship) already exists,
 * the weight is updated. Self-edges (source === target) are rejected.
 */
export async function insertEdge(db: HipppoDb, input: InsertEdgeInput): Promise<DecisionEdge> {
  if (input.sourceId === input.targetId) {
    throw new Error('insertEdge: self-edges are not allowed');
  }

  // Drizzle's sqlite-core onConflictDoUpdate needs a unique constraint; rather
  // than define one in the schema just for this, we do a read-then-upsert.
  const existing = await db
    .select()
    .from(decisionEdges)
    .where(
      and(
        eq(decisionEdges.sourceId, input.sourceId),
        eq(decisionEdges.targetId, input.targetId),
        eq(decisionEdges.relationship, input.relationship),
      ),
    )
    .limit(1);

  if (existing[0]) {
    if (input.weight !== undefined && input.weight !== existing[0].weight) {
      const [row] = await db
        .update(decisionEdges)
        .set({ weight: input.weight })
        .where(eq(decisionEdges.id, existing[0].id))
        .returning();
      return row ?? existing[0];
    }
    return existing[0];
  }

  const payload: NewDecisionEdge = {
    sourceId: input.sourceId,
    targetId: input.targetId,
    relationship: input.relationship,
  };
  if (input.weight !== undefined) payload.weight = input.weight;

  const [row] = await db.insert(decisionEdges).values(payload).returning();
  if (!row) throw new Error('insertEdge: insert returned no row');
  return row;
}

/** Edges originating from `sourceId`, optionally filtered by relationship. */
export async function outgoingEdges(
  db: HipppoDb,
  sourceId: string,
  relationship?: Relationship,
): Promise<DecisionEdge[]> {
  const conds = relationship
    ? and(eq(decisionEdges.sourceId, sourceId), eq(decisionEdges.relationship, relationship))
    : eq(decisionEdges.sourceId, sourceId);
  return db.select().from(decisionEdges).where(conds);
}

/** Edges terminating at `targetId`, optionally filtered by relationship. */
export async function incomingEdges(
  db: HipppoDb,
  targetId: string,
  relationship?: Relationship,
): Promise<DecisionEdge[]> {
  const conds = relationship
    ? and(eq(decisionEdges.targetId, targetId), eq(decisionEdges.relationship, relationship))
    : eq(decisionEdges.targetId, targetId);
  return db.select().from(decisionEdges).where(conds);
}

export async function deleteEdge(db: HipppoDb, id: string): Promise<boolean> {
  const res = await db
    .delete(decisionEdges)
    .where(eq(decisionEdges.id, id))
    .returning({ id: decisionEdges.id });
  return res.length > 0;
}
