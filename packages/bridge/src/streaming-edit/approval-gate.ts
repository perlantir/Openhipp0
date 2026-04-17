/**
 * Approval gate — races a user-decision resolver against a timer.
 * See CLAUDE.md §G2-b DECISION 3.
 *
 * Precedence (highest first):
 *   1. Per-call `ApprovalWaitOptions.timeoutMs` / `onTimeout`.
 *   2. Session-level `approvalTimeoutMs` / `approvalTimeoutMode`.
 *   3. Mode defaults (strict = 30s reject, permissive = 120s approve).
 *
 * On timeout: emits a synthetic `tool-call-rejected` StreamEvent (always
 * rejected shape — even in permissive-approve mode, the *event* says
 * rejected-for-timeout-but-proceeding, so the agent narrates truthfully.
 * The returned `ApprovalDecision.approved` is what the session acts on).
 */

import type { streaming } from '@openhipp0/core';

import {
  PERMISSIVE_DEFAULT_MS,
  STRICT_DEFAULT_MS,
  type ApprovalResolver,
  type ApprovalTimeoutMode,
  type ApprovalWaitOptions,
  type Timers,
} from './types.js';

const DEFAULT_TIMERS: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

export interface ApprovalGateOptions {
  readonly streamSink: streaming.StreamingSink;
  readonly mode: ApprovalTimeoutMode;
  /** Session-level timeout override. When set, overrides mode default. */
  readonly sessionTimeoutMs?: number;
  readonly timers?: Timers;
  readonly now?: () => string;
}

export class ApprovalGate {
  readonly #streamSink: streaming.StreamingSink;
  readonly #mode: ApprovalTimeoutMode;
  readonly #sessionTimeoutMs: number | undefined;
  readonly #timers: Timers;
  readonly #now: () => string;

  constructor(opts: ApprovalGateOptions) {
    this.#streamSink = opts.streamSink;
    this.#mode = opts.mode;
    this.#sessionTimeoutMs = opts.sessionTimeoutMs;
    this.#timers = opts.timers ?? DEFAULT_TIMERS;
    this.#now = opts.now ?? (() => new Date().toISOString());
  }

  async wait(
    preview: streaming.ToolCallPreviewEvent,
    resolver: ApprovalResolver,
    opts: ApprovalWaitOptions = {},
  ): Promise<streaming.ApprovalDecision> {
    const timeoutMs = this.#resolveTimeoutMs(opts);
    const onTimeout = this.#resolveOnTimeout(opts);

    let timedOut = false;
    let timerHandle: unknown = null;

    const timeoutPromise = new Promise<streaming.ApprovalDecision>((resolve) => {
      timerHandle = this.#timers.setTimeout(() => {
        timedOut = true;
        // Emit synthetic StreamEvent — truthful narration regardless of
        // approval/reject resolution policy.
        this.#streamSink.emit({
          kind: 'tool-call-rejected',
          turnId: preview.turnId,
          at: this.#now(),
          toolName: preview.toolName,
          approvalId: preview.approvalId,
          reason: `approval-timeout (${onTimeout} after ${timeoutMs}ms)`,
        });
        resolve({
          approvalId: preview.approvalId,
          approved: onTimeout === 'approve',
          reason: onTimeout === 'approve' ? 'timeout-permissive' : 'timeout',
        });
      }, timeoutMs);
    });

    const resolverPromise = resolver(preview).then((decision) => {
      if (!timedOut && timerHandle !== null) {
        this.#timers.clearTimeout(timerHandle);
        timerHandle = null;
      }
      return decision;
    });

    return Promise.race([resolverPromise, timeoutPromise]);
  }

  #resolveTimeoutMs(opts: ApprovalWaitOptions): number {
    if (typeof opts.timeoutMs === 'number') return opts.timeoutMs;
    if (typeof this.#sessionTimeoutMs === 'number') return this.#sessionTimeoutMs;
    return this.#mode === 'strict' ? STRICT_DEFAULT_MS : PERMISSIVE_DEFAULT_MS;
  }

  #resolveOnTimeout(opts: ApprovalWaitOptions): 'reject' | 'approve' {
    if (opts.onTimeout) return opts.onTimeout;
    return this.#mode === 'strict' ? 'reject' : 'approve';
  }
}
