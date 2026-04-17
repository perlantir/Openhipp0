/**
 * `StreamingEditSession` contracts. Shared across Telegram / Discord /
 * Slack edit-streaming adapters (PR #9 / #10 / #11).
 *
 * Decisions in CLAUDE.md §G2-b:
 *   1. Telegram MarkdownV2 strategy (plain-text during stream + final
 *      formatted edit + plain-text fallback on parse error).
 *   2. Debouncer `flush()` bypasses the timer on terminal events.
 *   3. Approval gate: 30s strict / 120s permissive, reject-on-timeout,
 *      emits a StreamEvent, per-call override wins.
 *   4. WhatsApp stays on SentenceChunker — no edit primitive available.
 *   5. Signal / Matrix / Mattermost deferred as BFW-009.
 */

import type { streaming } from '@openhipp0/core';

// ─── Bridge callbacks ────────────────────────────────────────────────────────

/** In-place edit of an existing message by id. Bridges supply this. */
export type EditFn = (
  messageId: string,
  text: string,
  opts?: { parseMode?: string },
) => Promise<void>;

/** Send a new message; returns the platform-scoped message id. */
export type SendFn = (
  text: string,
  opts?: { parseMode?: string },
) => Promise<string>;

/** Slack-style approval resolver. Returns a decision when the user acts. */
export type ApprovalResolver = (
  preview: streaming.ToolCallPreviewEvent,
) => Promise<streaming.ApprovalDecision>;

// ─── Approval mode ──────────────────────────────────────────────────────────

/**
 * Session-level timeout policy. Precedence rules:
 *   1. Per-call `ApprovalWaitOptions.timeoutMs` / `onTimeout`       (highest)
 *   2. Session-level `approvalTimeoutMs`                            (if set)
 *   3. Mode default (strict = 30_000ms reject / permissive = 120_000ms approve)
 *
 * If neither (1) nor (2) is set, the mode default applies. There is no
 * unconditional "60s fallback" — operators pick a mode OR set a value.
 */
export type ApprovalTimeoutMode = 'strict' | 'permissive';

export const STRICT_DEFAULT_MS = 30_000;
export const PERMISSIVE_DEFAULT_MS = 120_000;

export interface ApprovalWaitOptions {
  readonly timeoutMs?: number;
  readonly onTimeout?: 'reject' | 'approve';
}

// ─── Session options ─────────────────────────────────────────────────────────

export interface BridgeEditTarget {
  readonly channelId: string;
  readonly rootMessageId: string;
}

export interface SessionOptions {
  readonly target: BridgeEditTarget;
  readonly editFn: EditFn;
  readonly sendFn: SendFn;
  /** Receives synthetic events (approval-timeout, overflow rotation, etc.). */
  readonly streamSink: streaming.StreamingSink;
  /** Per-bridge default: Telegram 1000, Discord 200, Slack 1000. */
  readonly debounceMs: number;
  /** Per-bridge default: Telegram 4096, Discord 2000, Slack 40000. */
  readonly maxMessageBytes: number;
  /**
   * Explicit session timeout. Overrides the mode default when set. See
   * `ApprovalTimeoutMode` JSDoc for the precedence rules.
   */
  readonly approvalTimeoutMs?: number;
  /** Default 'strict'. */
  readonly approvalTimeoutMode?: ApprovalTimeoutMode;
  /** When set, `tool-call-preview` events route through here. */
  readonly approvalResolver?: ApprovalResolver;
  /**
   * Called on terminal event when set. Telegram's adapter wires this
   * for the plain-text → MarkdownV2 final re-edit. Each rotated message
   * is final-formatted *independently* — the rotation boundary is a
   * semantic boundary, and the escape+parse-mode edit operates on the
   * contents of one message at a time (see DECISION 1 AFFECTS).
   */
  readonly finalFormatEdit?: (messageId: string, text: string) => Promise<void>;
  /** Override for tests — defaults to `globalThis.setTimeout` / `clearTimeout`. */
  readonly timers?: Timers;
}

/** Minimal timer surface the session needs. Injectable for deterministic tests. */
export interface Timers {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

// ─── Errors ──────────────────────────────────────────────────────────────────

/**
 * Classification consumed by `StreamingEditSession` to decide retry /
 * backoff / giveup behavior per bridge-reported error.
 *
 * Per-kind session behavior:
 *
 *   'rate-limit' → absorb. Exponential-doubling backoff of the debounce
 *                  interval, capped at 4× base. Decays back to 1× after
 *                  10 consecutive successful edits with no further
 *                  rate-limits. `retryAfterMs` (from the bridge's
 *                  `Retry-After` header) overrides the next-tick delay
 *                  when larger than the computed backoff.
 *
 *   'transient'  → absorb. One retry on the next debounce tick at
 *                  baseline delay (no backoff change).
 *
 *   'parse-error' → caught ONLY for the final formatted edit; triggers
 *                   the plain-text fallback (DECISION 1). Not caught on
 *                   mid-stream edits (those are already plain text; a
 *                   parse-error there is a real bug).
 *
 *   'permanent'  → session disables further edits, emits a synthetic
 *                  'error' StreamEvent with the cause, and all subsequent
 *                  `feed()` calls become no-ops.
 */
export type EditErrorKind = 'rate-limit' | 'transient' | 'parse-error' | 'permanent';

export interface StreamingEditErrorOptions {
  /** Bridge-reported Retry-After value in ms, if present. */
  readonly retryAfterMs?: number;
  readonly cause?: unknown;
}

export class StreamingEditError extends Error {
  readonly kind: EditErrorKind;
  readonly retryAfterMs: number | undefined;
  override readonly cause: unknown;

  constructor(kind: EditErrorKind, message: string, opts: StreamingEditErrorOptions = {}) {
    super(message);
    this.name = 'StreamingEditError';
    this.kind = kind;
    this.retryAfterMs = opts.retryAfterMs;
    this.cause = opts.cause;
  }
}
