/**
 * Drizzle-backed PlanStore implementing @openhipp0/core/planning's PlanStore.
 */

import { and, asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { planning } from '@openhipp0/core';
type Plan = planning.Plan;
type PlanState = planning.PlanState;
type PlanStep = planning.PlanStep;
type PlanStore = planning.PlanStore;
type PlannerStepDraft = planning.PlannerStepDraft;
type StepStatus = planning.StepStatus;
type EvidenceRecord = planning.EvidenceRecord;
import type { HipppoDb } from '../db/client.js';
import {
  planRevisions,
  planSteps,
  plans,
  type NewPlan,
  type NewPlanStep,
  type NewPlanRevision,
  type PlanStepRow,
  type Plan as PlanRow,
} from '../db/schema.js';

export function createPlanStore(db: HipppoDb): PlanStore {
  async function loadFull(planId: string): Promise<Plan | null> {
    const [planRow] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
    if (!planRow) return null;
    const stepRows = await db
      .select()
      .from(planSteps)
      .where(eq(planSteps.planId, planId))
      .orderBy(asc(planSteps.order));
    return rowsToPlan(planRow, stepRows);
  }

  async function buildStepsForPlan(
    planId: string,
    drafts: readonly PlannerStepDraft[],
    startingOrder: number,
  ): Promise<PlanStep[]> {
    // Two-pass so parentIndex → parentStepId resolves predictably.
    const ids = drafts.map(() => `step-${randomUUID()}`);
    const rows: NewPlanStep[] = drafts.map((d, i) => ({
      id: ids[i]!,
      planId,
      parentStepId:
        d.parentIndex !== undefined && d.parentIndex >= 0 && d.parentIndex < ids.length
          ? ids[d.parentIndex]!
          : null,
      order: startingOrder + i,
      description: d.description,
      status: 'pending',
    }));
    if (rows.length === 0) return [];
    await db.insert(planSteps).values(rows);
    return rows.map(rowToStep);
  }

  return {
    async create(init: {
      projectId: string;
      sessionId?: string;
      goal: string;
      steps: readonly PlannerStepDraft[];
    }) {
      const now = new Date().toISOString();
      const planId = `plan-${randomUUID()}`;
      const payload: NewPlan = {
        id: planId,
        projectId: init.projectId,
        ...(init.sessionId && { sessionId: init.sessionId }),
        goal: init.goal,
        state: 'active',
        createdAt: now,
        updatedAt: now,
      };
      await db.insert(plans).values(payload);
      const steps = await buildStepsForPlan(planId, init.steps, 0);
      const firstStepId = steps[0]?.id ?? null;
      if (firstStepId) {
        await db
          .update(plans)
          .set({ currentStepId: firstStepId })
          .where(eq(plans.id, planId));
      }
      const result = await loadFull(planId);
      if (!result) throw new Error('createPlan: loadFull returned null');
      return result;
    },

    async get(planId: string) {
      return loadFull(planId);
    },

    async listByProject(
      projectId: string,
      opts: { state?: PlanState; limit?: number } = {},
    ) {
      const conditions = [eq(plans.projectId, projectId)];
      if (opts.state) conditions.push(eq(plans.state, opts.state));
      const rows = await db
        .select()
        .from(plans)
        .where(conditions.length === 1 ? conditions[0]! : and(...conditions))
        .limit(opts.limit ?? 100);
      const out: Plan[] = [];
      for (const r of rows) {
        const stepRows = await db
          .select()
          .from(planSteps)
          .where(eq(planSteps.planId, r.id))
          .orderBy(asc(planSteps.order));
        out.push(rowsToPlan(r, stepRows));
      }
      return out;
    },

    async setState(planId: string, state: PlanState, reason?: string) {
      const [planRow] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
      if (!planRow) return null;
      await db.update(plans).set({ state }).where(eq(plans.id, planId));
      if (reason) {
        const rev: NewPlanRevision = {
          planId,
          reason: `state→${state}: ${reason}`,
          delta: { added: [], removed: [] },
        };
        await db.insert(planRevisions).values(rev);
      }
      return loadFull(planId);
    },

    async setStepStatus(stepId: string, status: StepStatus, evidence?: EvidenceRecord) {
      const [stepRow] = await db.select().from(planSteps).where(eq(planSteps.id, stepId)).limit(1);
      if (!stepRow) return null;
      const now = new Date().toISOString();
      const patch: Partial<NewPlanStep> = {
        status: status as StepStatus,
        ...(evidence && { evidence: evidence as unknown as Record<string, unknown> }),
      };
      if (status === 'in_progress' && !stepRow.startedAt) patch.startedAt = now;
      if (status === 'completed') patch.finishedAt = now;
      await db.update(planSteps).set(patch).where(eq(planSteps.id, stepId));

      // Advance currentStepId / auto-complete when appropriate.
      const planId = stepRow.planId;
      const [planRow] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
      if (!planRow) return null;
      if (status === 'completed' && planRow.currentStepId === stepId) {
        const [next] = await db
          .select()
          .from(planSteps)
          .where(
            and(
              eq(planSteps.planId, planId),
              // We can't do OR(status=pending,status=in_progress) cleanly here;
              // instead fetch all remaining and pick in JS.
            ),
          )
          .orderBy(asc(planSteps.order));
        const nextStep = next
          ? (await db
              .select()
              .from(planSteps)
              .where(eq(planSteps.planId, planId))
              .orderBy(asc(planSteps.order))).find(
              (s) => s.id !== stepId && (s.status === 'pending' || s.status === 'in_progress'),
            )
          : undefined;
        const patchPlan: Partial<NewPlan> = { currentStepId: nextStep?.id ?? null };
        if (!nextStep) patchPlan.state = 'completed';
        await db.update(plans).set(patchPlan).where(eq(plans.id, planId));
      }
      const [updated] = await db.select().from(planSteps).where(eq(planSteps.id, stepId)).limit(1);
      return updated ? rowToStep(updated) : null;
    },

    async revise(planId: string, reason: string, newSteps: readonly PlannerStepDraft[]) {
      const [planRow] = await db.select().from(plans).where(eq(plans.id, planId)).limit(1);
      if (!planRow) return null;

      // Keep completed+skipped; drop the rest.
      const existing = await db
        .select()
        .from(planSteps)
        .where(eq(planSteps.planId, planId))
        .orderBy(asc(planSteps.order));
      const kept = existing.filter((s) => s.status === 'completed' || s.status === 'skipped');
      const removedIds = existing
        .filter((s) => s.status !== 'completed' && s.status !== 'skipped')
        .map((s) => s.id);

      if (removedIds.length > 0) {
        for (const rmId of removedIds) {
          await db.delete(planSteps).where(eq(planSteps.id, rmId));
        }
      }

      const nextStartOrder = kept.length;
      const addedSteps = await buildStepsForPlan(planId, newSteps, nextStartOrder);
      const firstNewId = addedSteps[0]?.id ?? null;
      await db
        .update(plans)
        .set({ currentStepId: firstNewId, state: 'active' })
        .where(eq(plans.id, planId));

      const rev: NewPlanRevision = {
        planId,
        reason,
        delta: {
          added: addedSteps.map((s) => s.id),
          removed: removedIds,
        },
      };
      await db.insert(planRevisions).values(rev);

      return loadFull(planId);
    },
  };
}

// ─── row conversion ───────────────────────────────────────────────────────

function rowToStep(r: PlanStepRow | NewPlanStep): PlanStep {
  const row = r as PlanStepRow;
  return {
    id: row.id,
    parentStepId: row.parentStepId ?? null,
    order: row.order,
    description: row.description,
    status: row.status as StepStatus,
    ...(row.evidence && { evidence: row.evidence as unknown as EvidenceRecord }),
    ...(row.startedAt && { startedAt: row.startedAt }),
    ...(row.finishedAt && { finishedAt: row.finishedAt }),
  };
}

function rowsToPlan(planRow: PlanRow, stepRows: readonly PlanStepRow[]): Plan {
  return {
    id: planRow.id,
    projectId: planRow.projectId,
    sessionId: planRow.sessionId ?? null,
    goal: planRow.goal,
    state: planRow.state as PlanState,
    currentStepId: planRow.currentStepId ?? null,
    steps: stepRows.map(rowToStep),
    createdAt: planRow.createdAt,
    updatedAt: planRow.updatedAt,
  };
}
