/**
 * Runtime integration glue for reflection.
 *
 *   maybeCritique(draft, ctx)  — runs rubric first; calls adapter.critiqueDraft
 *                                only if (a) the rubric flagged AND the caller
 *                                didn't disable-on-pass, or (b) the config
 *                                explicitly requests always-critique. Returns
 *                                `{apply: false}` when no revision is needed.
 *
 *   assessOutcomeAsync(req, cfg)  — fire-and-forget wrapper around
 *                                   adapter.assessOutcome. Errors are
 *                                   swallowed + logged into the persist hook
 *                                   so they never affect the user reply.
 */

import type { Message, ContentBlock } from '../llm/types.js';
import type { AgentIdentity } from '../agent/types.js';
import { runRubric } from './rubric.js';
import type {
  Critique,
  OutcomeAssessment,
  OutcomeRequest,
  ReflectionAdapter,
  ReflectionConfig,
  ReflectionEventInput,
  RubricReport,
} from './types.js';

const DEFAULT_MAX_REVISIONS = 1;
const HARD_MAX_REVISIONS = 2;
const DEFAULT_ACCEPT_CONFIDENCE_FLOOR = 0.55;

export interface CritiqueApplyDecision {
  readonly apply: boolean;
  readonly critique?: Critique;
  readonly rubric: RubricReport;
  readonly reason: 'rubric-pass-skip' | 'llm-accepted' | 'low-confidence' | 'needs-revision' | 'no-adapter';
}

export interface MaybeCritiqueInput {
  readonly adapter: ReflectionAdapter | undefined;
  readonly config: ReflectionConfig | undefined;
  readonly agent: AgentIdentity;
  readonly userMessage: string;
  readonly draft: string;
  readonly messages: readonly Message[];
  readonly hadToolCalls: boolean;
  readonly lastToolResultsHadError: boolean;
  readonly revisionsUsed: number;
  readonly projectId: string;
  readonly turnIndex: number;
}

export async function maybeCritique(input: MaybeCritiqueInput): Promise<CritiqueApplyDecision> {
  const cfg = input.config ?? {};
  const rubric = runRubric({
    draft: input.draft,
    messages: input.messages,
    hadToolCalls: input.hadToolCalls,
    lastToolResultsHadError: input.lastToolResultsHadError,
  });

  const adapter = input.adapter;
  const enabled = cfg.enabled ?? false;

  // No adapter / not enabled → never call LLM. Rubric still recorded.
  if (!enabled || !adapter?.critiqueDraft) {
    await persistCritique(cfg, input, rubric, undefined, false, false);
    return { apply: false, rubric, reason: 'no-adapter' };
  }

  const maxRevisions = clamp(cfg.maxRevisions ?? DEFAULT_MAX_REVISIONS, 0, HARD_MAX_REVISIONS);
  if (input.revisionsUsed >= maxRevisions) {
    await persistCritique(cfg, input, rubric, undefined, false, false);
    return { apply: false, rubric, reason: 'rubric-pass-skip' };
  }

  const skipOnPass = cfg.skipCritiqueWhenRubricPassesAndNoTools ?? true;
  if (rubric.pass && skipOnPass && !input.hadToolCalls) {
    await persistCritique(cfg, input, rubric, undefined, false, false);
    return { apply: false, rubric, reason: 'rubric-pass-skip' };
  }

  let critique: Critique;
  try {
    critique = await adapter.critiqueDraft({
      agent: input.agent,
      userMessage: input.userMessage,
      draft: input.draft,
      rubric,
      messages: input.messages,
      hadToolCalls: input.hadToolCalls,
    });
  } catch {
    // Critique failure must never fail the user reply.
    await persistCritique(cfg, input, rubric, undefined, true, false);
    return { apply: false, rubric, reason: 'no-adapter' };
  }

  const floor = cfg.acceptConfidenceFloor ?? DEFAULT_ACCEPT_CONFIDENCE_FLOOR;
  // If critic says reject but with low confidence, treat as accept (don't
  // revise on shaky signal).
  if (!critique.accept && critique.confidence < floor) {
    await persistCritique(cfg, input, rubric, critique, true, false);
    return { apply: false, critique, rubric, reason: 'low-confidence' };
  }

  if (critique.accept) {
    await persistCritique(cfg, input, rubric, critique, true, false);
    return { apply: false, critique, rubric, reason: 'llm-accepted' };
  }

  await persistCritique(cfg, input, rubric, critique, true, true);
  return { apply: true, critique, rubric, reason: 'needs-revision' };
}

/**
 * Compose a system-note message the runtime pushes into the conversation
 * to trigger one revision pass. The note is phrased as a reviewer's request
 * so the model re-issues an improved assistant turn.
 */
export function buildRevisionInstruction(critique: Critique): ContentBlock {
  const lines = [
    `The previous draft was flagged for revision: ${critique.reason}`,
    ...(critique.suggestions?.length
      ? ['Specifically, address:', ...critique.suggestions.map((s) => `- ${s}`)]
      : []),
    'Produce a single revised reply. Do NOT apologise or mention the revision process. Do NOT call new tools unless strictly required.',
  ];
  return { type: 'text', text: lines.join('\n') };
}

// ─── post-turn outcome assessment (async) ─────────────────────────────────

export interface AsyncOutcomeInput {
  readonly adapter: ReflectionAdapter | undefined;
  readonly config: ReflectionConfig | undefined;
  readonly projectId: string;
  readonly agentId: string;
  readonly turnIndex: number;
  readonly request: OutcomeRequest;
}

/**
 * Fire-and-forget. Always returns immediately; errors are swallowed into
 * the persist hook so ops can see them without the user ever being blocked.
 */
export function assessOutcomeAsync(input: AsyncOutcomeInput): void {
  const adapter = input.adapter;
  const cfg = input.config ?? {};
  if (!cfg.enabled || !adapter?.assessOutcome) return;

  // Schedule microtask so we don't block the caller.
  void Promise.resolve().then(async () => {
    try {
      const out = await adapter.assessOutcome!(input.request);
      await persistOutcome(cfg, input.projectId, input.agentId, input.turnIndex, out);
    } catch (err) {
      await persistOutcomeError(cfg, input.projectId, input.agentId, input.turnIndex, err);
    }
  });
}

// ─── persistence plumbing ─────────────────────────────────────────────────

async function persistCritique(
  cfg: ReflectionConfig,
  input: MaybeCritiqueInput,
  rubric: RubricReport,
  critique: Critique | undefined,
  llmInvoked: boolean,
  revisionApplied: boolean,
): Promise<void> {
  if (!cfg.persist) return;
  const evt: ReflectionEventInput = {
    kind: 'critique',
    projectId: input.projectId,
    agentId: input.agent.id,
    turnIndex: input.turnIndex,
    rubricIssues: rubric.issues.map((i) => i.code),
    llmInvoked,
    revisionApplied,
    ...(critique && {
      critiqueScore: critique.confidence,
      accept: critique.accept,
      reason: critique.reason.slice(0, 400),
    }),
  };
  try {
    await cfg.persist(evt);
  } catch {
    // persistence must never affect the hot path
  }
}

async function persistOutcome(
  cfg: ReflectionConfig,
  projectId: string,
  agentId: string,
  turnIndex: number,
  out: OutcomeAssessment,
): Promise<void> {
  if (!cfg.persist) return;
  const evt: ReflectionEventInput = {
    kind: 'outcome',
    projectId,
    agentId,
    turnIndex,
    rubricIssues: [],
    llmInvoked: true,
    outcomeScore: out.score,
    reason: out.reason.slice(0, 400),
  };
  try {
    await cfg.persist(evt);
  } catch {
    /* swallow */
  }
}

async function persistOutcomeError(
  cfg: ReflectionConfig,
  projectId: string,
  agentId: string,
  turnIndex: number,
  err: unknown,
): Promise<void> {
  if (!cfg.persist) return;
  const evt: ReflectionEventInput = {
    kind: 'outcome',
    projectId,
    agentId,
    turnIndex,
    rubricIssues: [],
    llmInvoked: true,
    reason: `assessment-error: ${(err as Error).message ?? 'unknown'}`.slice(0, 400),
  };
  try {
    await cfg.persist(evt);
  } catch {
    /* swallow */
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
