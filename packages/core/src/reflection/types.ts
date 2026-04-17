/**
 * Reflection subsystem — the agent critiques its own draft (pre-reply) and
 * assesses outcomes (post-reply) as optional, cost-controlled hooks.
 *
 * Design tenets (hardened from the original risk pass):
 *   - **Rubric-first, LLM-second.** Deterministic checks run before any LLM
 *     critique call. Most turns pass the rubric and skip the LLM entirely,
 *     so typical cost overhead is ~10–15 % rather than ~100 %.
 *   - **Asymmetric cost.** The adapter is expected to use a cheap model
 *     (Haiku-tier) for critique, leaving Opus/Sonnet for the primary draft.
 *   - **Hard revision cap.** `maxRevisions=1` by default, enforced in the
 *     runtime — not in the prompt — so a confused model can't talk its way
 *     into an infinite revise loop.
 *   - **Async outcome assessment.** Post-turn assessment NEVER blocks the
 *     user reply. It's queued and consumed by the reward model later.
 *   - **Confidence gating.** When the draft has no tool calls AND no rubric
 *     issues, skip the LLM critique by default.
 */

import type { ContentBlock, Message } from '../llm/types.js';
import type { AgentIdentity } from '../agent/types.js';

// ─── rubric ───────────────────────────────────────────────────────────────

/** Deterministic issue codes emitted by the rubric. */
export type RubricIssueCode =
  | 'empty-reply'
  | 'trivial-reply'
  | 'contains-placeholder'
  | 'tool-error-unacknowledged'
  | 'cited-missing-tool'
  | 'over-long-without-punctuation';

export interface RubricIssue {
  readonly code: RubricIssueCode;
  readonly detail: string;
}

export interface RubricReport {
  readonly pass: boolean;
  readonly issues: readonly RubricIssue[];
}

// ─── adapter contract ─────────────────────────────────────────────────────

export interface CritiqueRequest {
  readonly agent: AgentIdentity;
  readonly userMessage: string;
  readonly draft: string;
  readonly rubric: RubricReport;
  /** Full conversation so the critic can check on-topic + consistency. */
  readonly messages: readonly Message[];
  /** True when the assistant invoked any tools during this turn. */
  readonly hadToolCalls: boolean;
}

export interface Critique {
  /** When false, the runtime may apply one revision (if revisionsLeft > 0). */
  readonly accept: boolean;
  /** Human-readable summary. */
  readonly reason: string;
  /**
   * When `accept=false`, a concrete edit the model should make. Injected back
   * as a system note, NOT as the user's message — the user never sees this.
   */
  readonly suggestions?: readonly string[];
  /**
   * Normalized confidence 0..1 that `accept` is correct. Used to decide
   * whether to trust a cheap-critic model's "accept" without a second pass.
   */
  readonly confidence: number;
}

export interface OutcomeRequest {
  readonly agent: AgentIdentity;
  readonly prevAssistantText: string;
  /** The user's follow-up turn, OR the tool_result content for the next tool call. */
  readonly nextSignal:
    | { kind: 'user-turn'; text: string }
    | { kind: 'tool-result'; content: readonly ContentBlock[]; ok: boolean }
    | { kind: 'session-ended' };
}

export interface OutcomeAssessment {
  /** -1 (actively harmful) … 0 (neutral) … +1 (clearly helped). */
  readonly score: number;
  readonly reason: string;
  /** Evidence the assessment latched onto, for audit. */
  readonly evidence?: readonly string[];
}

/**
 * The structural contract — callers provide these bound to a cheap LLM.
 * Everything is optional; providing neither is a valid "reflection off"
 * configuration, indistinguishable from not passing the adapter at all.
 */
export interface ReflectionAdapter {
  critiqueDraft?(req: CritiqueRequest): Promise<Critique>;
  assessOutcome?(req: OutcomeRequest): Promise<OutcomeAssessment>;
}

// ─── runtime config ───────────────────────────────────────────────────────

export interface ReflectionConfig {
  /** Opt-in. Default false — zero change to existing callers. */
  readonly enabled?: boolean;
  /** Max critique→revise cycles per turn. Default 1. Hard cap at 2. */
  readonly maxRevisions?: number;
  /**
   * When true (default), skip the LLM critique entirely if the rubric
   * passes AND the turn had no tool calls. This is the main cost lever.
   */
  readonly skipCritiqueWhenRubricPassesAndNoTools?: boolean;
  /**
   * When critique.confidence < this value, ignore `accept=false` (avoid
   * revising on a shaky critic signal). Default 0.55.
   */
  readonly acceptConfidenceFloor?: number;
  /**
   * Persist every reflection event via this callback. Wired to the memory
   * package's `reflection_events` table in production.
   */
  readonly persist?: (evt: ReflectionEventInput) => Promise<void> | void;
}

export interface ReflectionEventInput {
  readonly kind: 'critique' | 'outcome';
  readonly sessionSeed?: string;
  readonly projectId: string;
  readonly agentId: string;
  readonly turnIndex: number;
  readonly rubricIssues: readonly RubricIssueCode[];
  readonly llmInvoked: boolean;
  readonly critiqueScore?: number;
  readonly accept?: boolean;
  readonly revisionApplied?: boolean;
  readonly outcomeScore?: number;
  readonly reason?: string;
}
