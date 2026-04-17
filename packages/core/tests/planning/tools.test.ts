import { describe, expect, it, vi } from 'vitest';
import { createEvidenceValidator } from '../../src/planning/evidence.js';
import { createInMemoryPlanStore } from '../../src/planning/in-memory-store.js';
import {
  planDecomposeTool,
  planProgressTool,
  planViewTool,
  planReviseTool,
  planAbandonTool,
} from '../../src/planning/tools.js';
import type { ExecutionContext } from '../../src/tools/types.js';
import type { PlannerOutput } from '../../src/planning/types.js';

const execCtx: ExecutionContext = {
  sandbox: 'native',
  timeoutMs: 1000,
  allowedPaths: [],
  allowedDomains: [],
  grantedPermissions: [],
  agent: { id: 'a', name: 'a', role: 'assistant' },
  projectId: 'p1',
};

function mkCtx(plannerOutput: PlannerOutput) {
  const store = createInMemoryPlanStore();
  const validator = createEvidenceValidator();
  return {
    projectId: 'p1',
    store,
    planner: vi.fn(async () => plannerOutput),
    validateEvidence: validator,
  };
}

describe('plan.decompose', () => {
  it('skips trivial asks unless force=true', async () => {
    const ctx = mkCtx({ steps: [{ description: 's' }] });
    const tool = planDecomposeTool(ctx);
    const r = await tool.execute(
      { goal: 'anything', userMessage: 'what time is it' },
      execCtx,
    );
    expect(r.ok).toBe(true);
    expect(String(r.output)).toContain('"skipped":true');
    expect(ctx.planner).not.toHaveBeenCalled();
  });

  it('creates a plan when the task is complex', async () => {
    const ctx = mkCtx({
      steps: [
        { description: 'step 1' },
        { description: 'step 2' },
        { description: 'step 3' },
      ],
    });
    const tool = planDecomposeTool(ctx);
    const r = await tool.execute(
      {
        goal: 'deploy + verify',
        userMessage:
          'First deploy the app. Then test staging. After that run smoke tests. Finally notify the team.',
      },
      execCtx,
    );
    expect(r.ok).toBe(true);
    expect(ctx.planner).toHaveBeenCalledOnce();
    const body = JSON.parse(String(r.output)) as { plan: { id: string; stepCount: number } };
    expect(body.plan.stepCount).toBe(3);
  });

  it('errors cleanly when planner returns zero steps', async () => {
    const ctx = mkCtx({ steps: [] });
    const tool = planDecomposeTool(ctx);
    const r = await tool.execute(
      { goal: 'x', userMessage: 'please plan this out step by step' },
      execCtx,
    );
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('PLAN_EMPTY');
  });
});

describe('plan.progress', () => {
  it('rejects completed without evidence', async () => {
    const ctx = mkCtx({ steps: [{ description: 'one' }] });
    const plan = await ctx.store.create({
      projectId: 'p1',
      goal: 'g',
      steps: [{ description: 'one' }],
    });
    const tool = planProgressTool(ctx);
    const stepId = plan.steps[0]!.id;
    const r = await tool.execute({ stepId, status: 'completed' }, execCtx);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('PLAN_EVIDENCE_REJECTED');
  });

  it('rejects completed with failing evidence', async () => {
    const ctx = mkCtx({ steps: [{ description: 'one' }] });
    const plan = await ctx.store.create({
      projectId: 'p1',
      goal: 'g',
      steps: [{ description: 'one' }],
    });
    const stepId = plan.steps[0]!.id;
    const tool = planProgressTool(ctx);
    const r = await tool.execute(
      {
        stepId,
        status: 'completed',
        evidence: { kind: 'exit-code-zero', detail: { exitCode: 1 } },
      },
      execCtx,
    );
    expect(r.ok).toBe(false);
  });

  it('accepts completed with valid evidence', async () => {
    const ctx = mkCtx({ steps: [{ description: 'one' }] });
    const plan = await ctx.store.create({
      projectId: 'p1',
      goal: 'g',
      steps: [{ description: 'one' }],
    });
    const stepId = plan.steps[0]!.id;
    const tool = planProgressTool(ctx);
    const r = await tool.execute(
      {
        stepId,
        status: 'completed',
        evidence: { kind: 'exit-code-zero', detail: { exitCode: 0 } },
      },
      execCtx,
    );
    expect(r.ok).toBe(true);
    const afterPlan = await ctx.store.get(plan.id);
    expect(afterPlan?.steps[0]?.status).toBe('completed');
    // Plan auto-completes when all steps done.
    expect(afterPlan?.state).toBe('completed');
  });

  it('accepts non-completed transitions without evidence (e.g. in_progress, blocked)', async () => {
    const ctx = mkCtx({ steps: [{ description: 'one' }] });
    const plan = await ctx.store.create({
      projectId: 'p1',
      goal: 'g',
      steps: [{ description: 'one' }],
    });
    const stepId = plan.steps[0]!.id;
    const tool = planProgressTool(ctx);
    const r = await tool.execute({ stepId, status: 'in_progress' }, execCtx);
    expect(r.ok).toBe(true);
  });
});

describe('plan.view + revise + abandon', () => {
  it('view returns the full plan', async () => {
    const ctx = mkCtx({ steps: [{ description: 'a' }, { description: 'b' }] });
    const plan = await ctx.store.create({
      projectId: 'p1',
      goal: 'g',
      steps: [{ description: 'a' }, { description: 'b' }],
    });
    const tool = planViewTool(ctx);
    const r = await tool.execute({ planId: plan.id }, execCtx);
    expect(r.ok).toBe(true);
    const body = JSON.parse(String(r.output)) as { plan: { steps: unknown[] } };
    expect(body.plan.steps).toHaveLength(2);
  });

  it('revise replaces pending steps and keeps completed', async () => {
    const ctx = mkCtx({ steps: [{ description: 'a' }, { description: 'b' }] });
    const plan = await ctx.store.create({
      projectId: 'p1',
      goal: 'g',
      steps: [{ description: 'a' }, { description: 'b' }],
    });
    // Complete the first step.
    await ctx.store.setStepStatus(plan.steps[0]!.id, 'completed', {
      kind: 'manual',
      detail: {},
      valid: true,
    });
    const tool = planReviseTool(ctx);
    const r = await tool.execute(
      {
        planId: plan.id,
        reason: 'new info',
        newSteps: [{ description: 'c' }, { description: 'd' }],
      },
      execCtx,
    );
    expect(r.ok).toBe(true);
    const post = await ctx.store.get(plan.id);
    expect(post?.steps.map((s) => s.description)).toEqual(['a', 'c', 'd']);
  });

  it('abandon flips state', async () => {
    const ctx = mkCtx({ steps: [{ description: 'a' }] });
    const plan = await ctx.store.create({
      projectId: 'p1',
      goal: 'g',
      steps: [{ description: 'a' }],
    });
    const tool = planAbandonTool(ctx);
    const r = await tool.execute({ planId: plan.id, reason: 'user pivoted' }, execCtx);
    expect(r.ok).toBe(true);
    const post = await ctx.store.get(plan.id);
    expect(post?.state).toBe('abandoned');
  });
});
