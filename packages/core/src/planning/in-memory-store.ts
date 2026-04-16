/**
 * In-memory PlanStore — reference implementation for tests and for callers
 * who don't need persistence. Production callers use the SQLite-backed store
 * in `@openhipp0/memory/planning`.
 */

import { randomUUID } from 'node:crypto';
import type {
  EvidenceRecord,
  Plan,
  PlanState,
  PlanStep,
  PlanStore,
  PlannerStepDraft,
  StepStatus,
} from './types.js';

export function createInMemoryPlanStore(): PlanStore {
  const plans = new Map<string, Plan>();

  function touch(plan: Plan, patch: Partial<Plan>): Plan {
    const updated: Plan = { ...plan, ...patch, updatedAt: new Date().toISOString() };
    plans.set(updated.id, updated);
    return updated;
  }

  function buildSteps(drafts: readonly PlannerStepDraft[]): PlanStep[] {
    const steps: PlanStep[] = drafts.map((d, i) => ({
      id: `step-${randomUUID()}`,
      parentStepId: d.parentIndex !== undefined ? null : null, // filled below
      order: i,
      description: d.description,
      status: 'pending' as StepStatus,
    }));
    // Resolve parent links by index.
    drafts.forEach((d, i) => {
      if (d.parentIndex !== undefined && d.parentIndex >= 0 && d.parentIndex < steps.length) {
        const s = steps[i]!;
        steps[i] = { ...s, parentStepId: steps[d.parentIndex]!.id };
      }
    });
    return steps;
  }

  return {
    async create(init) {
      const now = new Date().toISOString();
      const steps = buildSteps(init.steps);
      const plan: Plan = {
        id: `plan-${randomUUID()}`,
        projectId: init.projectId,
        sessionId: init.sessionId ?? null,
        goal: init.goal,
        state: 'active',
        currentStepId: steps[0]?.id ?? null,
        steps,
        createdAt: now,
        updatedAt: now,
      };
      plans.set(plan.id, plan);
      return plan;
    },

    async get(planId) {
      return plans.get(planId) ?? null;
    },

    async listByProject(projectId, opts = {}) {
      const out: Plan[] = [];
      for (const plan of plans.values()) {
        if (plan.projectId !== projectId) continue;
        if (opts.state && plan.state !== opts.state) continue;
        out.push(plan);
      }
      out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return opts.limit !== undefined ? out.slice(0, opts.limit) : out;
    },

    async setState(planId, state, reason) {
      const plan = plans.get(planId);
      if (!plan) return null;
      void reason; // reason persistence is storage-dependent
      return touch(plan, { state });
    },

    async setStepStatus(stepId, status, evidence) {
      for (const plan of plans.values()) {
        const idx = plan.steps.findIndex((s) => s.id === stepId);
        if (idx < 0) continue;
        const now = new Date().toISOString();
        const current = plan.steps[idx]!;
        const patchedStep: PlanStep = {
          ...current,
          status,
          ...(evidence && { evidence }),
          ...(status === 'in_progress' && !current.startedAt && { startedAt: now }),
          ...(status === 'completed' && { finishedAt: now }),
        };
        const newSteps = plan.steps.slice();
        newSteps[idx] = patchedStep;

        // Advance currentStepId to the next pending/in_progress step when we
        // complete the current one.
        let currentStepId = plan.currentStepId;
        if (status === 'completed' && plan.currentStepId === stepId) {
          const nextStep = newSteps.find(
            (s) => s.status === 'pending' || s.status === 'in_progress',
          );
          currentStepId = nextStep?.id ?? null;
        }

        // Auto-complete the plan when no steps remain.
        const anyPending = newSteps.some((s) => s.status === 'pending' || s.status === 'in_progress');
        const patch: { steps: PlanStep[]; currentStepId: string | null; state?: PlanState } = {
          steps: newSteps,
          currentStepId,
        };
        if (!anyPending) patch.state = 'completed';
        touch(plan, patch);
        return patchedStep;
      }
      return null;
    },

    async revise(planId, reason, newSteps) {
      const plan = plans.get(planId);
      if (!plan) return null;
      void reason;
      const completedSteps = plan.steps.filter((s) => s.status === 'completed' || s.status === 'skipped');
      const rest = buildSteps(newSteps).map((s, i) => ({
        ...s,
        order: completedSteps.length + i,
      }));
      const merged = [...completedSteps, ...rest];
      return touch(plan, {
        steps: merged,
        currentStepId: rest[0]?.id ?? null,
      });
    },
  };
}

export function summarizeStepCounts(steps: readonly PlanStep[]): Record<StepStatus, number> {
  const base: Record<StepStatus, number> = {
    pending: 0,
    in_progress: 0,
    blocked: 0,
    completed: 0,
    skipped: 0,
  };
  for (const s of steps) base[s.status]++;
  return base;
}

export function stateAfterStepUpdate(
  steps: readonly PlanStep[],
  currentState: PlanState,
): PlanState {
  if (steps.length === 0) return currentState;
  const anyRemaining = steps.some((s) => s.status === 'pending' || s.status === 'in_progress');
  if (!anyRemaining) return 'completed';
  return currentState;
}

export function pickNextStep(
  steps: readonly PlanStep[],
  excludeId?: string | null,
): PlanStep | undefined {
  return steps.find(
    (s) => s.id !== excludeId && (s.status === 'pending' || s.status === 'in_progress'),
  );
}

export function applyEvidenceDecision(
  step: PlanStep,
  status: StepStatus,
  evidence?: EvidenceRecord,
): PlanStep {
  const out: PlanStep = { ...step, status, ...(evidence && { evidence }) };
  return out;
}
