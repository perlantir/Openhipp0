/**
 * Workflow record + replay contracts.
 *
 * A workflow is an ordered list of `RecordedStep`s with named parameter
 * slots. Parameters are referenced by `${name}` in step values; the
 * player substitutes them at replay time.
 */

export const WORKFLOW_SCHEMA_VERSION = 1 as const;

export type StepKind = 'navigate' | 'click' | 'type' | 'select' | 'scroll' | 'wait' | 'extract';

export interface RecordedStep {
  readonly kind: StepKind;
  readonly at: string; // ISO
  /** Primary selector or ref. */
  readonly target?: string;
  /** For `type` / `select`. May include ${paramName}. */
  readonly value?: string;
  /** For `navigate`. May include ${paramName}. */
  readonly url?: string;
  /** For `scroll` / `wait` — numeric arg. */
  readonly magnitude?: number;
  /** Accessible label of the target at record time — used by AI healing. */
  readonly labelAtRecord?: string;
  /** Role at record time — used by AI healing. */
  readonly roleAtRecord?: string;
  /** Metadata (e.g. step index, source URL). */
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface Workflow {
  readonly version: typeof WORKFLOW_SCHEMA_VERSION;
  readonly name: string;
  readonly description?: string;
  readonly createdAt: string;
  readonly parameters: readonly WorkflowParameter[];
  readonly steps: readonly RecordedStep[];
}

export interface WorkflowParameter {
  readonly name: string;
  readonly description?: string;
  readonly default?: string;
  readonly kind?: 'text' | 'email' | 'password' | 'url' | 'number' | 'date';
}

export type ParameterValues = Readonly<Record<string, string>>;

// ─── Player contracts ───────────────────────────────────────────────────────

export interface HealingContext {
  readonly step: RecordedStep;
  /** Current a11y snapshot of the page. */
  readonly ax?: unknown;
  /** Last error the player saw — helps a healer understand what failed. */
  readonly error?: string;
}

export type SelectorHealer = (ctx: HealingContext) => Promise<string | null>;

export interface PlayResult {
  readonly ok: boolean;
  readonly completed: number;
  readonly failedAt?: number;
  readonly error?: string;
  readonly healedSteps: readonly { index: number; original: string; healed: string }[];
}

export interface PlayOptions {
  readonly parameters?: ParameterValues;
  readonly healer?: SelectorHealer;
  /** Max retries per step after healing (default 1). */
  readonly healerAttempts?: number;
  /** Timeout per action (default 10_000). */
  readonly actionTimeoutMs?: number;
}
