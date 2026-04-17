/**
 * Streaming runtime — pushes events to a `StreamingSink` as the agent
 * loop progresses.
 *
 * This is additive to `AgentRuntime`. Existing callers that want
 * sync responses keep using `AgentRuntime.handleMessage`; streaming
 * callers wrap their tool registry + LLM with this module and pipe
 * events to their transport (dashboard WebSocket, bridge adapter,
 * CLI renderer, etc.).
 */

import { randomUUID } from 'node:crypto';

import type {
  ApprovalDecision,
  ApprovalResolver,
  ProgressEmitter,
  ProgressEvent,
  StreamEvent,
  StreamingSink,
  ToolCallPreviewEvent,
  ToolPreviewStrategy,
} from './types.js';

export interface StreamingTurnInput {
  /** Free-text user input or derived agent prompt. */
  readonly input: string;
  /** Pass-through metadata. */
  readonly metadata?: Record<string, unknown>;
}

export interface StreamingToolSpec {
  readonly name: string;
  readonly strategy?: ToolPreviewStrategy;
  /** When set, `summarizeArgs(args)` is shown in the preview. */
  readonly summarizeArgs?: (args: Record<string, unknown>) => string;
  readonly execute: (
    args: Record<string, unknown>,
    reportProgress: ProgressEmitter,
    signal: AbortSignal,
  ) => Promise<unknown>;
}

export interface StreamingRuntimeOptions {
  readonly sink: StreamingSink;
  /** Called when a tool-call-preview needs a user decision. */
  readonly approve?: ApprovalResolver;
  /** Default strategy when a tool doesn't declare one. */
  readonly defaultStrategy?: ToolPreviewStrategy;
  /** Per-call strategy override (strict mode wraps every call in approval). */
  readonly strategyOverride?: (
    spec: StreamingToolSpec,
    args: Record<string, unknown>,
  ) => ToolPreviewStrategy | undefined;
  readonly now?: () => string;
}

export interface AbortHandle {
  readonly abort: (reason: string) => void;
  readonly signal: AbortSignal;
}

export class StreamingRuntime {
  readonly #sink: StreamingSink;
  readonly #approve: ApprovalResolver | undefined;
  readonly #defaultStrategy: ToolPreviewStrategy;
  readonly #strategyOverride: StreamingRuntimeOptions['strategyOverride'];
  readonly #now: () => string;
  readonly #tools = new Map<string, StreamingToolSpec>();

  constructor(opts: StreamingRuntimeOptions) {
    this.#sink = opts.sink;
    this.#approve = opts.approve;
    this.#defaultStrategy = opts.defaultStrategy ?? 'preview-approval';
    this.#strategyOverride = opts.strategyOverride;
    this.#now = opts.now ?? (() => new Date().toISOString());
  }

  register(spec: StreamingToolSpec): void {
    this.#tools.set(spec.name, spec);
  }

  /**
   * Stream a simple turn: emit turn-started, stream tokens from an async
   * iterable, optionally invoke tools (with preview → approval →
   * execute), emit done.
   */
  async stream(
    turn: StreamingTurnInput,
    steps: AsyncIterable<StreamEventSource>,
  ): Promise<{ turnId: string; aborted: boolean; reason: string }> {
    const turnId = randomUUID();
    const abortController = new AbortController();
    let aborted = false;
    let reason = 'completed';

    this.#emit({ kind: 'turn-started', turnId, at: this.#now(), input: turn.input, ...(turn.metadata ? { metadata: turn.metadata } : {}) });

    for await (const step of steps) {
      if (abortController.signal.aborted) break;
      if (step.kind === 'token') {
        this.#emit({ kind: 'token', turnId, at: this.#now(), text: step.text });
        continue;
      }
      if (step.kind === 'partial') {
        this.#emit({ kind: 'partial', turnId, at: this.#now(), text: step.text });
        continue;
      }
      if (step.kind === 'tool-call') {
        const outcome = await this.#invokeTool(turnId, step, abortController);
        if (outcome === 'aborted') {
          aborted = true;
          reason = 'user-rejected-tool';
          break;
        }
        continue;
      }
      if (step.kind === 'abort') {
        abortController.abort();
        aborted = true;
        reason = step.reason;
        this.#emit({ kind: 'interrupted', turnId, at: this.#now(), reason: step.reason });
        break;
      }
    }

    this.#emit({ kind: 'done', turnId, at: this.#now(), reason });
    try {
      await this.#sink.close?.();
    } catch {
      /* close errors don't affect producer outcome */
    }
    return { turnId, aborted, reason };
  }

  async #invokeTool(
    turnId: string,
    step: ToolCallStep,
    abortController: AbortController,
  ): Promise<'ok' | 'aborted' | 'error'> {
    const spec = this.#tools.get(step.toolName);
    if (!spec) {
      this.#emit({
        kind: 'tool-result',
        turnId,
        at: this.#now(),
        toolName: step.toolName,
        ok: false,
        error: `unknown tool: ${step.toolName}`,
      });
      return 'error';
    }
    const strategy =
      this.#strategyOverride?.(spec, step.args) ?? spec.strategy ?? this.#defaultStrategy;
    const approvalId = randomUUID();
    const summary = step.summary ?? spec.summarizeArgs?.(step.args) ?? '';

    if (strategy !== 'auto-execute') {
      const preview: ToolCallPreviewEvent = {
        kind: 'tool-call-preview',
        turnId,
        at: this.#now(),
        toolName: spec.name,
        args: step.args,
        previewStrategy: strategy,
        approvalId,
        ...(summary ? { summary } : {}),
      };
      this.#emit(preview);

      if (strategy === 'preview-auto-3s') {
        // Caller may abort during the 3s window; we honor that without an
        // explicit approve/reject event.
        const decision = await raceWithAbort(3000, abortController.signal);
        if (decision === 'aborted') return 'aborted';
      } else if (strategy === 'preview-approval' || strategy === 'preview-approval-typed') {
        if (!this.#approve) {
          this.#emit({
            kind: 'error',
            turnId,
            at: this.#now(),
            code: 'HIPP0_STREAMING_NO_APPROVER',
            message: `tool ${spec.name} requires approval but no approver wired`,
          });
          return 'error';
        }
        const decision = await this.#approve(preview);
        if (!decision.approved) {
          this.#emit({
            kind: 'tool-call-rejected',
            turnId,
            at: this.#now(),
            toolName: spec.name,
            approvalId,
            ...(decision.reason ? { reason: decision.reason } : {}),
            ...(decision.redirect ? { redirect: decision.redirect } : {}),
          });
          return 'aborted';
        }
        this.#emit({
          kind: 'tool-call-approved',
          turnId,
          at: this.#now(),
          toolName: spec.name,
          approvalId,
          ...(decision.reason ? { reason: decision.reason } : {}),
        });
        if (decision.redirect) {
          step = { kind: 'tool-call', toolName: decision.redirect.toolName, args: decision.redirect.args };
        }
      }
    }

    const exec: StreamEvent = {
      kind: 'tool-call-execute',
      turnId,
      at: this.#now(),
      toolName: step.toolName,
      args: step.args,
    };
    this.#emit(exec);

    try {
      const reportProgress: ProgressEmitter = (ev) => {
        this.#emit({
          kind: 'progress',
          turnId,
          at: this.#now(),
          ...(spec.name ? { toolName: spec.name } : {}),
          ...ev,
        } satisfies ProgressEvent);
      };
      const result = await (this.#tools.get(step.toolName)?.execute(
        step.args,
        reportProgress,
        abortController.signal,
      ) ?? spec.execute(step.args, reportProgress, abortController.signal));
      this.#emit({
        kind: 'tool-result',
        turnId,
        at: this.#now(),
        toolName: step.toolName,
        ok: true,
        result,
      });
      return 'ok';
    } catch (err) {
      this.#emit({
        kind: 'tool-result',
        turnId,
        at: this.#now(),
        toolName: step.toolName,
        ok: false,
        error: (err as Error).message,
      });
      return 'error';
    }
  }

  #emit(event: StreamEvent): void {
    try {
      this.#sink.emit(event);
    } catch {
      /* sink errors don't break producer */
    }
  }
}

export type StreamEventSource =
  | { kind: 'token'; text: string }
  | { kind: 'partial'; text: string }
  | ToolCallStep
  | { kind: 'abort'; reason: string };

interface ToolCallStep {
  readonly kind: 'tool-call';
  readonly toolName: string;
  readonly args: Record<string, unknown>;
  readonly summary?: string;
}

function raceWithAbort(waitMs: number, signal: AbortSignal): Promise<'timeout' | 'aborted'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve('timeout');
    }, waitMs);
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve('aborted');
    };
    if (signal.aborted) {
      clearTimeout(timer);
      resolve('aborted');
      return;
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

// ─── Default sinks ─────────────────────────────────────────────────────────

export class BufferStreamSink implements StreamingSink {
  readonly events: StreamEvent[] = [];
  emit(event: StreamEvent): void {
    this.events.push(event);
  }
}

export class CallbackStreamSink implements StreamingSink {
  readonly #cb: (e: StreamEvent) => void;
  constructor(cb: (e: StreamEvent) => void) {
    this.#cb = cb;
  }
  emit(event: StreamEvent): void {
    this.#cb(event);
  }
}
