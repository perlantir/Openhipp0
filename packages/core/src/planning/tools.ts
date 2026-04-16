/**
 * plan.* tools — agent-facing surface for the planning subsystem.
 *
 * These are structural tools (no filesystem / network I/O besides the
 * store); they take a pre-constructed `PlanStore` + `Planner` + evidence
 * validator so the tools stay pure.
 */

import { z } from 'zod';
import type { Tool, ToolResult } from '../tools/types.js';
import { estimateComplexity } from './complexity.js';
import type {
  EvidenceRecord,
  EvidenceValidator,
  Plan,
  PlanStore,
  Planner,
  StepStatus,
} from './types.js';

export interface PlanToolContext {
  readonly projectId: string;
  readonly sessionId?: string;
  readonly store: PlanStore;
  readonly planner: Planner;
  readonly validateEvidence: EvidenceValidator;
}

// ─── plan.decompose ───────────────────────────────────────────────────────

const DecomposeParams = z.object({
  goal: z.string().min(1).max(2000),
  userMessage: z.string().min(1).max(8000),
  force: z.boolean().optional(),
});
type DecomposeParams = z.infer<typeof DecomposeParams>;

export function planDecomposeTool(ctx: PlanToolContext): Tool<DecomposeParams> {
  return {
    name: 'plan.decompose',
    description:
      'Break a complex user goal into ordered sub-steps. Runs a complexity check first — returns {skipped: true} for trivial asks unless force=true. Stores the plan server-side and returns its id.',
    inputSchema: {
      type: 'object',
      required: ['goal', 'userMessage'],
      properties: {
        goal: { type: 'string', description: 'High-level outcome to achieve.' },
        userMessage: { type: 'string', description: "The user's verbatim turn (for heuristics)." },
        force: { type: 'boolean', description: 'Bypass the complexity gate.' },
      },
    },
    validator: DecomposeParams,
    permissions: [],
    async execute(params): Promise<ToolResult> {
      const verdict = estimateComplexity(params.userMessage);
      if (!verdict.shouldPlan && !params.force) {
        return {
          ok: true,
          output: JSON.stringify({
            skipped: true,
            verdict,
            reason: 'task appears trivial; call again with force:true to plan anyway',
          }),
        };
      }
      const draft = await ctx.planner({
        goal: params.goal,
        userMessage: params.userMessage,
      });
      if (draft.steps.length === 0) {
        return {
          ok: false,
          errorCode: 'PLAN_EMPTY',
          output: 'planner returned zero steps',
        };
      }
      const plan = await ctx.store.create({
        projectId: ctx.projectId,
        ...(ctx.sessionId && { sessionId: ctx.sessionId }),
        goal: params.goal,
        steps: draft.steps,
      });
      return { ok: true, output: JSON.stringify({ plan: compactPlan(plan) }) };
    },
  };
}

// ─── plan.view ────────────────────────────────────────────────────────────

const ViewParams = z.object({ planId: z.string().min(1) });
type ViewParams = z.infer<typeof ViewParams>;

export function planViewTool(ctx: PlanToolContext): Tool<ViewParams> {
  return {
    name: 'plan.view',
    description: 'Fetch the full plan (every step, status, evidence) by id.',
    inputSchema: {
      type: 'object',
      required: ['planId'],
      properties: { planId: { type: 'string' } },
    },
    validator: ViewParams,
    permissions: [],
    async execute(params): Promise<ToolResult> {
      const plan = await ctx.store.get(params.planId);
      if (!plan) return { ok: false, errorCode: 'PLAN_NOT_FOUND', output: `${params.planId}` };
      return { ok: true, output: JSON.stringify({ plan }) };
    },
  };
}

// ─── plan.progress ────────────────────────────────────────────────────────

const EvidenceRecordSchema = z.object({
  kind: z.enum([
    'manual',
    'file-exists',
    'file-content-matches',
    'exit-code-zero',
    'http-2xx',
    'tool-result-ok',
    'assertion-passed',
  ]),
  detail: z.record(z.unknown()),
  valid: z.boolean().optional(),
  reason: z.string().optional(),
  verifiedAt: z.string().optional(),
});

const ProgressParams = z.object({
  stepId: z.string().min(1),
  status: z.enum(['pending', 'in_progress', 'blocked', 'completed', 'skipped']),
  evidence: EvidenceRecordSchema.optional(),
});
type ProgressParams = z.infer<typeof ProgressParams>;

export function planProgressTool(ctx: PlanToolContext): Tool<ProgressParams> {
  return {
    name: 'plan.progress',
    description:
      'Update a step status. Transitions to "completed" REQUIRE an evidence object that is validated server-side — the agent cannot mark a step complete without passing the validator.',
    inputSchema: {
      type: 'object',
      required: ['stepId', 'status'],
      properties: {
        stepId: { type: 'string' },
        status: { enum: ['pending', 'in_progress', 'blocked', 'completed', 'skipped'] },
        evidence: {
          type: 'object',
          properties: {
            kind: {
              enum: [
                'manual',
                'file-exists',
                'file-content-matches',
                'exit-code-zero',
                'http-2xx',
                'tool-result-ok',
                'assertion-passed',
              ],
            },
            detail: { type: 'object' },
          },
          required: ['kind', 'detail'],
        },
      },
    },
    validator: ProgressParams,
    permissions: [],
    async execute(params): Promise<ToolResult> {
      let evidence: EvidenceRecord | undefined;
      if (params.evidence) {
        const raw: EvidenceRecord = {
          kind: params.evidence.kind,
          detail: params.evidence.detail,
          valid: false,
          ...(params.evidence.reason !== undefined && { reason: params.evidence.reason }),
        };
        evidence = await ctx.validateEvidence(raw);
      }
      if (params.status === 'completed' && (!evidence || !evidence.valid)) {
        return {
          ok: false,
          errorCode: 'PLAN_EVIDENCE_REJECTED',
          output: JSON.stringify({
            reason: evidence?.reason ?? 'completed requires verifiable evidence',
            evidence,
          }),
        };
      }
      const updated = await ctx.store.setStepStatus(params.stepId, params.status as StepStatus, evidence);
      if (!updated) return { ok: false, errorCode: 'PLAN_STEP_NOT_FOUND', output: `${params.stepId}` };
      return { ok: true, output: JSON.stringify({ step: updated }) };
    },
  };
}

// ─── plan.revise ──────────────────────────────────────────────────────────

const ReviseParams = z.object({
  planId: z.string().min(1),
  reason: z.string().min(1).max(500),
  newSteps: z
    .array(
      z.object({
        description: z.string().min(1).max(500),
        parentIndex: z.number().int().min(0).optional(),
        evidenceSuggestion: EvidenceRecordSchema.shape.kind.optional(),
      }),
    )
    .min(1),
});
type ReviseParams = z.infer<typeof ReviseParams>;

export function planReviseTool(ctx: PlanToolContext): Tool<ReviseParams> {
  return {
    name: 'plan.revise',
    description:
      'Replace a plan\'s remaining steps with a revised list. Records the revision reason + diff. Use when the initial plan was wrong or new information invalidates it.',
    inputSchema: {
      type: 'object',
      required: ['planId', 'reason', 'newSteps'],
      properties: {
        planId: { type: 'string' },
        reason: { type: 'string' },
        newSteps: {
          type: 'array',
          items: {
            type: 'object',
            required: ['description'],
            properties: {
              description: { type: 'string' },
              parentIndex: { type: 'integer' },
              evidenceSuggestion: {
                enum: [
                  'manual',
                  'file-exists',
                  'file-content-matches',
                  'exit-code-zero',
                  'http-2xx',
                  'tool-result-ok',
                  'assertion-passed',
                ],
              },
            },
          },
        },
      },
    },
    validator: ReviseParams,
    permissions: [],
    async execute(params): Promise<ToolResult> {
      const plan = await ctx.store.revise(params.planId, params.reason, params.newSteps);
      if (!plan) return { ok: false, errorCode: 'PLAN_NOT_FOUND', output: `${params.planId}` };
      return { ok: true, output: JSON.stringify({ plan: compactPlan(plan) }) };
    },
  };
}

// ─── plan.abandon ─────────────────────────────────────────────────────────

const AbandonParams = z.object({
  planId: z.string().min(1),
  reason: z.string().min(1).max(500),
});
type AbandonParams = z.infer<typeof AbandonParams>;

export function planAbandonTool(ctx: PlanToolContext): Tool<AbandonParams> {
  return {
    name: 'plan.abandon',
    description: 'Mark a plan abandoned. Use when the user pivots or the goal becomes irrelevant.',
    inputSchema: {
      type: 'object',
      required: ['planId', 'reason'],
      properties: { planId: { type: 'string' }, reason: { type: 'string' } },
    },
    validator: AbandonParams,
    permissions: [],
    async execute(params): Promise<ToolResult> {
      const plan = await ctx.store.setState(params.planId, 'abandoned', params.reason);
      if (!plan) return { ok: false, errorCode: 'PLAN_NOT_FOUND', output: params.planId };
      return { ok: true, output: JSON.stringify({ plan: compactPlan(plan) }) };
    },
  };
}

/** All plan.* tools, ready to register into a ToolRegistry. */
export function planTools(ctx: PlanToolContext): readonly Tool[] {
  return [
    planDecomposeTool(ctx),
    planViewTool(ctx),
    planProgressTool(ctx),
    planReviseTool(ctx),
    planAbandonTool(ctx),
  ];
}

function compactPlan(plan: Plan): Record<string, unknown> {
  return {
    id: plan.id,
    goal: plan.goal,
    state: plan.state,
    currentStepId: plan.currentStepId,
    stepCount: plan.steps.length,
    completed: plan.steps.filter((s) => s.status === 'completed').length,
  };
}
