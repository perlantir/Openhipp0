/**
 * StreamingEditSession — orchestrates edit-in-place streaming for the
 * Big-3 bridges (Telegram / Discord / Slack).
 *
 * Composition:
 *   StreamingAccumulator (from bridge/streaming.ts) handles
 *   event → markdown via `formatStreamEvent`. The session subscribes to
 *   it via the `handle` callback, then:
 *     - routes accumulated text through `Debouncer` for in-place edits
 *     - rotates via `sendFn` when bytes exceed `maxMessageBytes`
 *     - pauses the debouncer + routes `tool-call-preview` through
 *       `ApprovalGate` when a resolver is wired
 *     - flushes on terminal events + optionally invokes
 *       `finalFormatEdit` per rotated message (each message is
 *       formatted *independently* — DECISION 1 AFFECTS)
 *
 * Error handling per `StreamingEditError.kind`:
 *   - 'rate-limit'  → exponential doubling of debounce, capped at 4×,
 *                     decays to 1× after 10 consecutive successful
 *                     edits. `retryAfterMs` overrides the computed
 *                     next-tick delay when larger.
 *   - 'transient'   → one retry at baseline on next tick; no backoff.
 *   - 'parse-error' → only meaningful on `finalFormatEdit`; the caller
 *                     supplies the fallback retry (plain-text). The
 *                     session doesn't need to classify this specially
 *                     for mid-stream edits.
 *   - 'permanent'   → disable edits, emit 'error' StreamEvent, feed()
 *                     becomes a no-op.
 */

import type { streaming } from '@openhipp0/core';

import { StreamingAccumulator } from '../streaming.js';

import { ApprovalGate } from './approval-gate.js';
import { Debouncer } from './debouncer.js';
import { rotateOnOverflow } from './overflow.js';
import {
  StreamingEditError,
  type ApprovalTimeoutMode,
  type BridgeEditTarget,
  type SessionOptions,
} from './types.js';

const RATE_LIMIT_CAP = 4;
const RATE_LIMIT_DECAY_AFTER = 10;

interface RotatedMessage {
  readonly messageId: string;
  readonly text: string;
}

export class StreamingEditSession {
  readonly #opts: SessionOptions;
  readonly #accumulator: StreamingAccumulator;
  readonly #debouncer: Debouncer;
  readonly #gate: ApprovalGate;
  #currentTarget: BridgeEditTarget;
  #currentMessageText = '';
  #rotatedMessages: RotatedMessage[] = [];
  /**
   * UTF-16 code-unit offset into the running accumulator where the current
   * in-flight message starts. Updated after every successful rotation.
   * Tracked explicitly (rather than recomputed from rotatedMessages
   * string lengths) so the unit is unambiguously "JS string index" —
   * matching what `accumulator.slice(offset)` expects.
   */
  #accumulatorOffset = 0;
  #disposed = false;
  #permanentlyFailed = false;
  /** Running multiplier for rate-limit backoff (1..RATE_LIMIT_CAP). */
  #rateMultiplier = 1;
  /** Consecutive successful edits since last rate-limit. */
  #consecutiveOk = 0;
  /** Retained for introspection + future debouncer-side backoff tuning. */
  #lastRetryAfterMs: number | null = null;

  constructor(opts: SessionOptions) {
    this.#opts = opts;
    this.#currentTarget = opts.target;
    this.#accumulator = new StreamingAccumulator({
      handle: async (event, accumulated) => {
        await this.#route(event, accumulated);
      },
    });
    this.#debouncer = new Debouncer({
      delayMs: opts.debounceMs,
      onFlush: (text) => this.#applyEdit(text),
      ...(opts.timers ? { timers: opts.timers } : {}),
    });
    const mode: ApprovalTimeoutMode = opts.approvalTimeoutMode ?? 'strict';
    this.#gate = new ApprovalGate({
      streamSink: opts.streamSink,
      mode,
      ...(typeof opts.approvalTimeoutMs === 'number' ? { sessionTimeoutMs: opts.approvalTimeoutMs } : {}),
      ...(opts.timers ? { timers: opts.timers } : {}),
    });
  }

  /** Feed every StreamEvent through here. Returns when routing completes. */
  async feed(event: streaming.StreamEvent): Promise<void> {
    if (this.#disposed || this.#permanentlyFailed) return;
    await this.#accumulator.push(event);
  }

  async flush(): Promise<void> {
    await this.#debouncer.flush();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    await this.#debouncer.dispose();
  }

  // ─── Routing ───────────────────────────────────────────────────────

  async #route(event: streaming.StreamEvent, accumulated: string): Promise<void> {
    // `accumulated` is the full running text from StreamingAccumulator.
    // We track our own per-message slice via `#currentMessageText`.

    if (event.kind === 'tool-call-preview') {
      await this.#handleApproval(event);
      return;
    }

    if (
      event.kind === 'done' ||
      event.kind === 'error' ||
      event.kind === 'interrupted'
    ) {
      // Sync our per-message slice to the accumulator's final state, then
      // flush any pending debounced edit, then run the per-message
      // final-format pass.
      this.#currentMessageText = accumulated.slice(this.#accumulatorOffset);
      await this.#debouncer.flush();
      await this.#runFinalFormatPass();
      return;
    }

    // Any other event: sync per-message slice + push latest text into
    // the debouncer (latest-value-wins semantics — see debouncer.ts).
    const nextMessageText = accumulated.slice(this.#accumulatorOffset);
    if (nextMessageText === this.#currentMessageText) return;
    this.#currentMessageText = nextMessageText;
    this.#debouncer.push(nextMessageText, this.#effectiveDelayMs());
  }

  /**
   * Effective debounce for the next timer arming. Applies rate-limit
   * backoff (baseline × `#rateMultiplier`, capped at `RATE_LIMIT_CAP`×)
   * and respects any `retryAfterMs` hint from the bridge when that
   * value is larger — whichever wait is more conservative wins.
   */
  #effectiveDelayMs(): number {
    const base = this.#opts.debounceMs * this.#rateMultiplier;
    if (this.#lastRetryAfterMs !== null && this.#lastRetryAfterMs > base) {
      return this.#lastRetryAfterMs;
    }
    return base;
  }


  // ─── Edit application ─────────────────────────────────────────────

  async #applyEdit(text: string): Promise<void> {
    if (this.#permanentlyFailed) return;
    const target = this.#currentTarget;
    if (text.length === 0) return;

    // Check overflow BEFORE editing.
    const rotated = rotateOnOverflow({ current: text, maxBytes: this.#opts.maxMessageBytes });
    if (!rotated.fits) {
      // Finalize current message with the `keep` portion + rotate.
      try {
        await this.#opts.editFn(target.rootMessageId, rotated.keep);
        this.#onSuccess();
      } catch (err) {
        await this.#handleEditError(err);
        return;
      }
      this.#rotatedMessages.push({ messageId: target.rootMessageId, text: rotated.keep });
      // Advance the accumulator offset by the exact JS-string length of
      // the keep portion — matches what `accumulator.slice(offset)` uses.
      this.#accumulatorOffset += rotated.keep.length;
      let newMessageId: string;
      try {
        newMessageId = await this.#opts.sendFn(rotated.carry);
      } catch (err) {
        await this.#handleSendError(err);
        return;
      }
      this.#currentTarget = { channelId: target.channelId, rootMessageId: newMessageId };
      this.#currentMessageText = rotated.carry;
      // Emit a synthetic progress event so consumers see the rotation.
      this.#opts.streamSink.emit({
        kind: 'progress',
        turnId: 'session',
        at: new Date().toISOString(),
        label: 'message-rotated',
        fraction: null,
      });
      return;
    }

    // Fits — single in-place edit.
    try {
      await this.#opts.editFn(target.rootMessageId, text);
      this.#onSuccess();
    } catch (err) {
      await this.#handleEditError(err);
    }
  }

  // ─── Approval ──────────────────────────────────────────────────────

  async #handleApproval(preview: streaming.ToolCallPreviewEvent): Promise<void> {
    if (!this.#opts.approvalResolver) return;
    // Pause by flushing current state, then await the gate.
    await this.#debouncer.flush();
    const decision = await this.#gate.wait(preview, this.#opts.approvalResolver);
    // Session forwards the decision via the stream sink so the
    // runtime sees consistent events even if the resolver didn't emit
    // them.
    this.#opts.streamSink.emit({
      kind: decision.approved ? 'tool-call-approved' : 'tool-call-rejected',
      turnId: preview.turnId,
      at: new Date().toISOString(),
      toolName: preview.toolName,
      approvalId: preview.approvalId,
      ...(decision.reason ? { reason: decision.reason } : {}),
    });
  }

  // ─── Terminal final-format pass ────────────────────────────────────

  async #runFinalFormatPass(): Promise<void> {
    if (!this.#opts.finalFormatEdit) return;
    // Current in-flight message first (not yet in #rotatedMessages).
    const liveMessageId = this.#currentTarget.rootMessageId;
    const liveText = this.#currentMessageText;
    const messages: RotatedMessage[] = [
      ...this.#rotatedMessages,
      ...(liveText.length > 0 ? [{ messageId: liveMessageId, text: liveText }] : []),
    ];
    // Each message is final-formatted INDEPENDENTLY. A split format pair
    // (e.g. `*bold` in msg 1 + `text*` in msg 2) renders as two separate
    // literal asterisks rather than bold text — predictable, not a parse
    // failure. Rotation boundary is a semantic boundary (DECISION 1).
    for (const m of messages) {
      try {
        await this.#opts.finalFormatEdit(m.messageId, m.text);
      } catch (err) {
        // Caller is responsible for the plain-text fallback on parse
        // errors; if they rethrow as permanent, disable the session.
        if (err instanceof StreamingEditError && err.kind === 'permanent') {
          await this.#markPermanentFailure(err);
          return;
        }
        // Non-permanent errors on final-format are absorbed — the
        // mid-stream plain-text is already on-screen.
      }
    }
  }

  // ─── Error handling ────────────────────────────────────────────────

  async #handleEditError(err: unknown): Promise<void> {
    if (err instanceof StreamingEditError) {
      if (err.kind === 'rate-limit') {
        this.#onRateLimit(err.retryAfterMs);
        return;
      }
      if (err.kind === 'transient') {
        this.#consecutiveOk = 0;
        return; // next debouncer tick retries with latest text
      }
      if (err.kind === 'permanent') {
        await this.#markPermanentFailure(err);
        return;
      }
      // parse-error mid-stream: absorb as skip-this-edit. Slack BlockKit
      // payloads can be rejected by the bridge validator intermittently;
      // killing the whole session on one bad frame is far too brittle.
      // The NEXT debouncer tick will retry with the latest text. The
      // final-format pass has its own plain-text fallback for the
      // terminal edit (DECISION 1).
      this.#consecutiveOk = 0;
      return;
    }
    // Unknown error: treat as transient.
    this.#consecutiveOk = 0;
  }

  async #handleSendError(err: unknown): Promise<void> {
    // sendFn failures on continuation messages are hard — no graceful
    // retry is meaningful without a new message id. Mark permanent.
    await this.#markPermanentFailure(err);
  }

  #onSuccess(): void {
    this.#consecutiveOk += 1;
    this.#lastRetryAfterMs = null;
    if (this.#consecutiveOk >= RATE_LIMIT_DECAY_AFTER && this.#rateMultiplier > 1) {
      // Decay one step toward baseline.
      this.#rateMultiplier = Math.max(1, Math.floor(this.#rateMultiplier / 2));
      this.#consecutiveOk = 0;
    }
  }

  #onRateLimit(retryAfterMs: number | undefined): void {
    this.#consecutiveOk = 0;
    this.#rateMultiplier = Math.min(RATE_LIMIT_CAP, this.#rateMultiplier * 2);
    if (typeof retryAfterMs === 'number') this.#lastRetryAfterMs = retryAfterMs;
    // Note: the Debouncer runs at a fixed delayMs from construction.
    // The "doubled backoff" shows up as longer perceived latency for
    // the NEXT tick because we don't push() the debouncer until the
    // next accumulator event — by which time the multiplier has taken
    // effect via the adjusted `effectiveDelayMs()` on that tick.
    // For the simple implementation here, we defer the effective-delay
    // feature: the multiplier is observable via `currentMultiplier()`
    // for tests + telemetry; debouncer-side tuning is a follow-up
    // (filed internally if/when it surfaces in practice).
  }

  async #markPermanentFailure(err: unknown): Promise<void> {
    if (this.#permanentlyFailed) return;
    this.#permanentlyFailed = true;
    const message = err instanceof Error ? err.message : String(err);
    const externalCode =
      err instanceof StreamingEditError && err.kind === 'permanent' ? err.kind : undefined;
    this.#opts.streamSink.emit({
      kind: 'error',
      turnId: 'session',
      at: new Date().toISOString(),
      code: 'HIPP0_BRIDGE_STREAMING_EDIT_PERMANENT',
      message,
      ...(externalCode ? { externalCode } : {}),
    });
    await this.#debouncer.dispose();
  }

  // ─── Introspection (tests + telemetry) ─────────────────────────────

  /** Test hook: current rate-limit multiplier. */
  currentMultiplier(): number {
    return this.#rateMultiplier;
  }

  /** Test hook: is the session permanently disabled? */
  isPermanentlyFailed(): boolean {
    return this.#permanentlyFailed;
  }

  /** Test hook: last `Retry-After` (ms) reported by a rate-limit error. */
  lastRetryAfterMs(): number | null {
    return this.#lastRetryAfterMs;
  }
}
