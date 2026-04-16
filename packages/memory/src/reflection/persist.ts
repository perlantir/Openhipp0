/**
 * Drizzle-backed persist hook for ReflectionEventInput → reflection_events.
 *
 * The core package owns the ReflectionAdapter contract + event shape; this
 * module just wires the persist callback to the SQL table. Callers construct
 * it once (usually in serve.ts) and pass it into ReflectionConfig.persist.
 */

import type { HipppoDb } from '../db/client.js';
import { reflectionEvents, type NewReflectionEvent } from '../db/schema.js';

export interface ReflectionEventInput {
  readonly kind: 'critique' | 'outcome';
  readonly projectId: string;
  readonly agentId: string;
  readonly sessionSeed?: string;
  readonly turnIndex: number;
  readonly rubricIssues: readonly string[];
  readonly llmInvoked: boolean;
  readonly critiqueScore?: number;
  readonly accept?: boolean;
  readonly revisionApplied?: boolean;
  readonly outcomeScore?: number;
  readonly reason?: string;
}

export function createReflectionPersist(db: HipppoDb): (evt: ReflectionEventInput) => Promise<void> {
  return async (evt) => {
    const row: NewReflectionEvent = {
      projectId: evt.projectId,
      agentId: evt.agentId,
      turnIndex: evt.turnIndex,
      kind: evt.kind,
      rubricIssues: [...evt.rubricIssues],
      llmInvoked: evt.llmInvoked,
      revisionApplied: evt.revisionApplied ?? false,
      ...(evt.sessionSeed && { sessionId: evt.sessionSeed }),
      ...(evt.critiqueScore !== undefined && { critiqueScore: evt.critiqueScore }),
      ...(evt.accept !== undefined && { accept: evt.accept }),
      ...(evt.outcomeScore !== undefined && { outcomeScore: evt.outcomeScore }),
      ...(evt.reason && { reason: evt.reason.slice(0, 2000) }),
    };
    await db.insert(reflectionEvents).values(row);
  };
}
