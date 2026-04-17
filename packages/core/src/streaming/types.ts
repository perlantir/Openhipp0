/**
 * Streaming-first agent loop protocol.
 *
 * The existing AgentRuntime remains the synchronous-response surface;
 * `StreamingRuntime` wraps it to emit a sequence of `StreamEvent`s:
 *   - token — partial LLM output
 *   - tool-call-preview — announce tool + args BEFORE executing
 *   - tool-call-approved / tool-call-rejected — user's decision
 *   - tool-call-execute — runtime is now invoking the tool
 *   - tool-result — tool returned
 *   - progress — long-running tool reports progress
 *   - partial — free-form intermediate text
 *   - done / error — terminal events
 *
 * All events carry `turnId` + `at` (ISO) so consumers can interleave
 * multiple in-flight turns safely.
 */

export type StreamEventKind =
  | 'turn-started'
  | 'token'
  | 'partial'
  | 'tool-call-preview'
  | 'tool-call-approved'
  | 'tool-call-rejected'
  | 'tool-call-execute'
  | 'tool-result'
  | 'progress'
  | 'interrupted'
  | 'error'
  | 'done';

export interface StreamEventBase {
  readonly kind: StreamEventKind;
  readonly turnId: string;
  readonly at: string;
}

export interface TurnStartedEvent extends StreamEventBase {
  readonly kind: 'turn-started';
  readonly input: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface TokenEvent extends StreamEventBase {
  readonly kind: 'token';
  readonly text: string;
}

export interface PartialEvent extends StreamEventBase {
  readonly kind: 'partial';
  readonly text: string;
}

export interface ToolCallPreviewEvent extends StreamEventBase {
  readonly kind: 'tool-call-preview';
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly previewStrategy: ToolPreviewStrategy;
  readonly approvalId: string;
  /** Human-readable summary for display. */
  readonly summary?: string;
}

export interface ToolCallDecisionEvent extends StreamEventBase {
  readonly kind: 'tool-call-approved' | 'tool-call-rejected';
  readonly approvalId: string;
  readonly toolName: string;
  readonly reason?: string;
  /** Rejection: caller can attach a redirected tool+args via this. */
  readonly redirect?: { readonly toolName: string; readonly args: Record<string, unknown> };
}

export interface ToolCallExecuteEvent extends StreamEventBase {
  readonly kind: 'tool-call-execute';
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
}

export interface ToolResultEvent extends StreamEventBase {
  readonly kind: 'tool-result';
  readonly toolName: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

export interface ProgressEvent extends StreamEventBase {
  readonly kind: 'progress';
  readonly label: string;
  /** 0..1, or null for indeterminate. */
  readonly fraction: number | null;
  readonly toolName?: string;
}

export interface InterruptedEvent extends StreamEventBase {
  readonly kind: 'interrupted';
  readonly reason: string;
}

export interface ErrorEvent extends StreamEventBase {
  readonly kind: 'error';
  readonly code: string;
  readonly message: string;
  readonly externalCode?: string;
}

export interface DoneEvent extends StreamEventBase {
  readonly kind: 'done';
  readonly reason: string;
  readonly totalTokens?: number;
}

export type StreamEvent =
  | TurnStartedEvent
  | TokenEvent
  | PartialEvent
  | ToolCallPreviewEvent
  | ToolCallDecisionEvent
  | ToolCallExecuteEvent
  | ToolResultEvent
  | ProgressEvent
  | InterruptedEvent
  | ErrorEvent
  | DoneEvent;

// ─── Tool-call preview protocol ─────────────────────────────────────────────

/**
 * Per-tool preview strategy. Tools declare it on their manifest; agents can
 * override per-call via `PreviewOptions`.
 */
export type ToolPreviewStrategy =
  | 'auto-execute' // safe reads, deterministic ops — no preview needed
  | 'preview-auto-3s' // preview with 3-second cancel window, then auto-execute
  | 'preview-approval' // require approval before executing
  | 'preview-approval-typed'; // require approval AND user types confirmation

export interface PreviewOptions {
  /** Override strategy at call time (e.g., strict mode wraps every call in approval). */
  readonly strategy?: ToolPreviewStrategy;
  /** Summary to surface in the preview (human-friendly). */
  readonly summary?: string;
  /** Required typed confirmation for `preview-approval-typed`. */
  readonly typedConfirmation?: string;
}

export interface ApprovalDecision {
  readonly approvalId: string;
  readonly approved: boolean;
  readonly reason?: string;
  readonly redirect?: { toolName: string; args: Record<string, unknown> };
  readonly typedConfirmation?: string;
}

// ─── Stream consumer contract ──────────────────────────────────────────────

export interface StreamingSink {
  emit(event: StreamEvent): void;
  /** Called once after the final event (done/error/interrupted). */
  close?(): void | Promise<void>;
}

/**
 * Approval resolver — returns a promise that settles when the user
 * decides. Producers call it on `preview-approval*` events.
 */
export type ApprovalResolver = (preview: ToolCallPreviewEvent) => Promise<ApprovalDecision>;

/** Caller-supplied hook for long-running tools to emit progress events. */
export type ProgressEmitter = (event: Omit<ProgressEvent, 'kind' | 'at' | 'turnId'>) => void;
