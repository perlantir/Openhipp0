/**
 * Planning subsystem — explicit plan decomposition + progress tracking.
 *
 * Design tenets (hardened):
 *   - **Complexity-gated**: a cheap heuristic (imperative-verb count +
 *     ordinal-structure markers) decides whether a task is worth planning.
 *     Trivial asks never invoke the planner.
 *   - **Compact injection**: each turn's prompt carries only
 *     `{goal, currentStep, nextStep}` — not the full step list. The agent
 *     fetches the full plan on demand via the `plan.view` tool.
 *   - **Evidence-gated completion**: steps require deterministic evidence
 *     before transitioning to `completed`. The agent cannot lie to its own
 *     tracker — validators run server-side.
 *   - **Lifecycle states**: `draft | active | paused | completed | abandoned`.
 *     Auto-abandon on drift (semantic) or N turns of inactivity.
 *   - **Memory artifact**: plans persist across restarts + multi-agent
 *     handoff. Not runtime-only state.
 */

export type PlanState = 'draft' | 'active' | 'paused' | 'completed' | 'abandoned';
export type StepStatus = 'pending' | 'in_progress' | 'blocked' | 'completed' | 'skipped';

export type EvidenceKind =
  | 'manual'
  | 'file-exists'
  | 'file-content-matches'
  | 'exit-code-zero'
  | 'http-2xx'
  | 'tool-result-ok'
  | 'assertion-passed';

export interface EvidenceRecord {
  readonly kind: EvidenceKind;
  /** Free-form payload the validator inspects (path, URL, captured stdout…). */
  readonly detail: Record<string, unknown>;
  /** When true the tracker accepts `completed`; when false rejects. */
  readonly valid: boolean;
  /** Validator's reason — surfaced back to the agent. */
  readonly reason?: string;
  /** Timestamp the evidence was validated. */
  readonly verifiedAt?: string;
}

export interface PlanStep {
  readonly id: string;
  readonly parentStepId: string | null;
  readonly order: number;
  readonly description: string;
  readonly status: StepStatus;
  readonly evidence?: EvidenceRecord;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface Plan {
  readonly id: string;
  readonly projectId: string;
  readonly sessionId: string | null;
  readonly goal: string;
  readonly state: PlanState;
  readonly currentStepId: string | null;
  readonly steps: readonly PlanStep[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PlanRevision {
  readonly id: string;
  readonly planId: string;
  readonly reason: string;
  readonly delta: { readonly added: readonly string[]; readonly removed: readonly string[] };
  readonly createdAt: string;
}

// ─── complexity heuristic ─────────────────────────────────────────────────

export interface ComplexityVerdict {
  readonly shouldPlan: boolean;
  readonly estimatedSubtasks: number;
  readonly signals: readonly string[];
}

// ─── planner contract ─────────────────────────────────────────────────────

export interface PlannerInput {
  readonly goal: string;
  /** Optional context so the LLM-backed planner can include sub-goal relevance. */
  readonly userMessage: string;
}

export interface PlannerStepDraft {
  readonly description: string;
  readonly parentIndex?: number;
  readonly evidenceSuggestion?: EvidenceKind;
}

export interface PlannerOutput {
  readonly steps: readonly PlannerStepDraft[];
  readonly rationale?: string;
}

export type Planner = (input: PlannerInput) => Promise<PlannerOutput>;

// ─── evidence validators ──────────────────────────────────────────────────

export type EvidenceValidator = (ev: EvidenceRecord) => Promise<EvidenceRecord>;

// ─── storage contract (backend-agnostic) ──────────────────────────────────

export interface PlanStore {
  create(init: { projectId: string; sessionId?: string; goal: string; steps: readonly PlannerStepDraft[] }): Promise<Plan>;
  get(planId: string): Promise<Plan | null>;
  listByProject(projectId: string, opts?: { state?: PlanState; limit?: number }): Promise<readonly Plan[]>;
  setState(planId: string, state: PlanState, reason?: string): Promise<Plan | null>;
  setStepStatus(stepId: string, status: StepStatus, evidence?: EvidenceRecord): Promise<PlanStep | null>;
  revise(planId: string, reason: string, newSteps: readonly PlannerStepDraft[]): Promise<Plan | null>;
}
