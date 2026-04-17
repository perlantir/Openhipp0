/**
 * Slack edit-streaming adapter — third + final consumer of
 * `StreamingEditSession` (PR #8 shared infra). See CLAUDE.md Phase G2-b
 * adapters DECISIONs 11-A through 11-I for rationale.
 *
 * Responsibilities:
 *   - Produce the `editFn` / `sendFn` / `finalFormatEdit` callbacks the
 *     session expects, against a `@slack/web-api` `WebClient` handle +
 *     channel id.
 *   - Classify Slack WebAPI errors into `StreamingEditError` kinds so the
 *     session's rate-limit / transient / permanent handling fires
 *     correctly (DECISION 11-F).
 *   - Provide an `ApprovalResolver` that posts a Block Kit message with
 *     Approve / Reject buttons and resolves on the matching
 *     `block_actions` interactivity payload (DECISION 11-C / 11-H).
 *   - Clean up the approval prompt via `response_url` + `replace_original:
 *     true` — idempotent, fire-and-forget (DECISION 11-C).
 *
 * Required Slack OAuth scopes (DECISION 11-H4):
 *   chat:write — used by `chat.postMessage` (approval prompt + rotated
 *                messages) and `chat.update` (streaming edits).
 *   No additional scope is needed for approval cleanup: `response_url` is
 *   a one-time URL granted with the interactivity payload and bypasses
 *   token-scope checks. It's also not counted against the Tier-3
 *   `chat.update` rate bucket.
 *
 * Differences from Telegram / Discord:
 *   - `maxMessageBytes = 40000` is an EXACT UTF-8 byte cap, not a
 *     conservative under-approximation of a code-unit cap (DECISION 11-A).
 *   - `finalFormatEdit` ships the plain-during-stream + terminal-mrkdwn
 *     pattern (like Telegram, unlike Discord) with a two-pass escaper
 *     that handles Slack's non-CommonMark syntax (DECISION 11-B +
 *     `slack-mrkdwn.ts`).
 *   - Approval cleanup uses `response_url` with `replace_original: true`,
 *     NOT `chat.update` (DECISION 11-C).
 *   - Debounce defaults to 1000ms to match Tier-3 `chat.update` rate
 *     (1 req/sec/channel) (DECISION 11-G).
 *   - No lazy channel resolution — Slack channel ids are opaque strings
 *     used directly in `chat.*` calls (DECISION 11-H3).
 */

import type { streaming } from '@openhipp0/core';

import {
  StreamingEditError,
  type ApprovalResolver,
  type EditErrorKind,
  type EditFn,
  type SendFn,
  type SessionOptions,
} from '../types.js';

import { escapeSlackMrkdwn } from './slack-mrkdwn.js';

const SLACK_BYTE_CAP = 40_000;
const DEFAULT_DEBOUNCE_MS = 1000;
const APPROVAL_ARGS_PREVIEW_MAX = 200;

const CB_PREFIX_APPROVE = 'hipp0-approve:';
const CB_PREFIX_REJECT = 'hipp0-reject:';

/**
 * Slack WebAPI platform-error codes that always indicate the resource is
 * gone or the bot lacks permission — never recoverable by retry.
 * See https://api.slack.com/methods/chat.update + chat.postMessage.
 */
const PERMANENT_SLACK_CODES = new Set<string>([
  'channel_not_found',
  'not_in_channel',
  'is_archived',
  'msg_too_long',
  'message_not_found',
  'invalid_auth',
  'account_inactive',
  'token_revoked',
  'missing_scope',
  'not_authed',
]);

/** Transient platform errors — retry next tick, do not escalate backoff. */
const TRANSIENT_SLACK_CODES = new Set<string>(['fatal_error', 'internal_error']);

/** Parse-error platform errors — Slack rejected the payload shape. */
const PARSE_ERROR_SLACK_CODES = new Set<string>(['invalid_arguments', 'invalid_blocks']);

const NETWORK_ERROR_CODES = new Set<string>([
  'ECONNRESET',
  'ETIMEDOUT',
  'ENETUNREACH',
  'EAI_AGAIN',
]);

/**
 * Structural shape of the `@slack/web-api` `WebClient` surface this adapter
 * actually consumes. Tests construct a minimal fake implementing exactly
 * this; production passes either a directly-constructed `WebClient` or a
 * Bolt `App.client` (which IS a `WebClient`).
 */
export interface WebClientSurface {
  readonly chat: {
    postMessage(args: {
      channel: string;
      text?: string | undefined;
      blocks?: readonly unknown[] | undefined;
    }): Promise<{ ok: boolean; ts?: string | undefined; [k: string]: unknown }>;
    update(args: {
      channel: string;
      ts: string;
      text?: string | undefined;
      blocks?: readonly unknown[] | undefined;
      mrkdwn?: boolean | undefined;
    }): Promise<{ ok: boolean; [k: string]: unknown }>;
  };
}

export interface SlackAdapterOptions {
  readonly web: WebClientSurface;
  readonly channel: string;
  /** Defaults to 1000ms per DECISION 11-G (matches Tier-3 chat.update cadence). */
  readonly debounceMs?: number;
  /**
   * POST implementation used for approval cleanup via `response_url`.
   * Defaults to `globalThis.fetch` (Node 22 native). Tests inject a spy.
   */
  readonly fetchImpl?: typeof fetch;
}

/**
 * Narrow shape the adapter actually consumes off a Slack `block_actions`
 * interactivity payload. Tests construct this directly; production callers
 * pass either a raw `block_actions` payload (parsed via
 * `parseBlockActionsPayload`) or this parsed shape (recognized via
 * `isParsedSlackInteraction`). DECISION 11-D.
 */
export interface ParsedSlackInteraction {
  readonly actionId: string;
  readonly responseUrl: string;
}

/**
 * Discriminated union returned by `classifySlackError`. Matches PR #10's
 * pattern — exhaustive `switch (result.kind)` at every call site, no
 * `instanceof` narrowing, no `null` sentinels (DECISION 11-E).
 *
 *   'classified' → rethrow `error` (session routes per `kind`)
 *   'absorb'     → swallow silently. NOTE: Slack has no known error that
 *                  reaches this branch — identical-content `chat.update`
 *                  returns `ok: true` silently, not an error. Retained for
 *                  cross-bridge `switch` parity with Telegram + Discord.
 *                  Test T-22 enforces that no fixture ever returns
 *                  `'absorb'`. `#sendFn` throws an invariant-violation
 *                  error if this branch ever fires (DECISION 11-F).
 *   'unknown'    → unrecognized shape; caller rethrows the original.
 */
export type ClassifiedError =
  | { readonly kind: 'classified'; readonly error: StreamingEditError }
  | { readonly kind: 'absorb' }
  | { readonly kind: 'unknown' };

/**
 * Discriminates the narrow parsed shape from a raw `block_actions` payload.
 * The load-bearing check is `!('actions' in x)` — every real Slack
 * interactivity payload has an `actions` array; the parsed shape does not.
 * Named guard per PR #10 lesson #3.
 */
export function isParsedSlackInteraction(x: unknown): x is ParsedSlackInteraction {
  return (
    typeof x === 'object' &&
    x !== null &&
    'actionId' in x &&
    'responseUrl' in x &&
    typeof (x as ParsedSlackInteraction).actionId === 'string' &&
    typeof (x as ParsedSlackInteraction).responseUrl === 'string' &&
    !('actions' in x)
  );
}

/**
 * Pulls the fields the adapter needs off a Slack `block_actions` payload.
 * Returns `null` for non-block_actions types, missing action arrays,
 * missing `response_url`, or otherwise malformed inputs. Isolated so tests
 * don't have to construct the full Slack interactivity envelope.
 */
export function parseBlockActionsPayload(input: unknown): ParsedSlackInteraction | null {
  if (typeof input !== 'object' || input === null) return null;
  const p = input as {
    type?: unknown;
    actions?: unknown;
    response_url?: unknown;
  };
  if (p.type !== 'block_actions') return null;
  if (!Array.isArray(p.actions) || p.actions.length === 0) return null;
  const first = p.actions[0] as { action_id?: unknown } | undefined;
  if (!first || typeof first.action_id !== 'string') return null;
  if (typeof p.response_url !== 'string' || p.response_url.length === 0) return null;
  return { actionId: first.action_id, responseUrl: p.response_url };
}

function makeClassified(kind: EditErrorKind, message: string, cause: unknown): ClassifiedError {
  return {
    kind: 'classified',
    error: new StreamingEditError(kind, message, { cause }),
  };
}

interface SlackErrorLike {
  code?: unknown;
  data?: { error?: unknown; ok?: unknown };
  statusCode?: unknown;
  retryAfter?: unknown;
  headers?: unknown;
  message?: string;
}

function readRetryAfterMsFromHeaders(headers: unknown): number | undefined {
  if (headers === null || headers === undefined) return undefined;
  let val: string | null | undefined;
  // Headers object (fetch/undici style)
  if (typeof (headers as { get?: unknown }).get === 'function') {
    val = (headers as { get: (k: string) => string | null }).get('retry-after');
  } else if (typeof headers === 'object') {
    const h = headers as Record<string, unknown>;
    const raw = h['retry-after'] ?? h['Retry-After'];
    val = typeof raw === 'string' ? raw : undefined;
  }
  if (val == null) return undefined;
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 1000);
}

/**
 * Classifies a `@slack/web-api` error into the session's error vocabulary.
 * Single site, exhaustive, safe default of `'transient'` for unknown Error
 * shapes (next tick retries) — matches PR #10's classifier philosophy.
 *
 * Mapping (DECISION 11-F):
 *   - `code === 'slack_webapi_rate_limited_error'`
 *       → `rate-limit`, `retryAfterMs = err.retryAfter * 1000`
 *   - `code === 'slack_webapi_platform_error'`:
 *       - `data.error === 'ratelimited'`      → `rate-limit` (retryAfterMs from headers if present)
 *       - `data.error in PERMANENT_SLACK_CODES` → `permanent`
 *       - `data.error in PARSE_ERROR_SLACK_CODES` → `parse-error`
 *       - `data.error in TRANSIENT_SLACK_CODES` → `transient`
 *       - any other                            → `transient` (safe default)
 *   - `code === 'slack_webapi_http_error'`:
 *       - status 401/403/404 → `permanent`
 *       - status 429         → `rate-limit` (retryAfterMs from headers)
 *       - 5xx / other        → `transient`
 *   - `code === 'slack_webapi_request_error'` → `transient`
 *   - `Error` with `code` in `{ECONNRESET, ETIMEDOUT, ENETUNREACH, EAI_AGAIN}` → `transient`
 *   - any other `Error`      → `transient` (safe default)
 *   - non-Error throw        → `{kind: 'unknown'}`
 */
export function classifySlackError(err: unknown): ClassifiedError {
  if (!(err instanceof Error)) return { kind: 'unknown' };
  const e = err as Error & SlackErrorLike;
  const code = typeof e.code === 'string' ? e.code : undefined;
  const msg = e.message ?? '';

  if (code === 'slack_webapi_rate_limited_error') {
    const retryAfter = typeof e.retryAfter === 'number' ? e.retryAfter : undefined;
    const retryAfterMs = retryAfter !== undefined ? Math.round(retryAfter * 1000) : undefined;
    return {
      kind: 'classified',
      error: new StreamingEditError(
        'rate-limit',
        `Slack rate-limited: ${msg}`,
        retryAfterMs !== undefined ? { retryAfterMs, cause: err } : { cause: err },
      ),
    };
  }

  if (code === 'slack_webapi_platform_error') {
    const slackError =
      e.data && typeof e.data.error === 'string' ? (e.data.error as string) : undefined;
    if (slackError === 'ratelimited') {
      const retryAfterMs = readRetryAfterMsFromHeaders(e.headers);
      return {
        kind: 'classified',
        error: new StreamingEditError(
          'rate-limit',
          `Slack ratelimited (platform): ${msg}`,
          retryAfterMs !== undefined ? { retryAfterMs, cause: err } : { cause: err },
        ),
      };
    }
    if (slackError && PERMANENT_SLACK_CODES.has(slackError)) {
      return makeClassified('permanent', `Slack ${slackError}: ${msg}`, err);
    }
    if (slackError && PARSE_ERROR_SLACK_CODES.has(slackError)) {
      return makeClassified('parse-error', `Slack ${slackError}: ${msg}`, err);
    }
    if (slackError && TRANSIENT_SLACK_CODES.has(slackError)) {
      return makeClassified('transient', `Slack ${slackError}: ${msg}`, err);
    }
    return makeClassified('transient', `Slack ${slackError ?? 'platform'}: ${msg}`, err);
  }

  if (code === 'slack_webapi_http_error') {
    const status = typeof e.statusCode === 'number' ? e.statusCode : undefined;
    if (status === 401 || status === 403 || status === 404) {
      return makeClassified('permanent', `Slack HTTP ${status}: ${msg}`, err);
    }
    if (status === 429) {
      const retryAfterMs = readRetryAfterMsFromHeaders(e.headers);
      return {
        kind: 'classified',
        error: new StreamingEditError(
          'rate-limit',
          `Slack HTTP 429: ${msg}`,
          retryAfterMs !== undefined ? { retryAfterMs, cause: err } : { cause: err },
        ),
      };
    }
    return makeClassified('transient', `Slack HTTP ${status ?? '??'}: ${msg}`, err);
  }

  if (code === 'slack_webapi_request_error') {
    return makeClassified('transient', `Slack network: ${msg}`, err);
  }

  if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) {
    return makeClassified('transient', `Network: ${msg}`, err);
  }

  return makeClassified('transient', msg || 'Unknown Slack error', err);
}

/**
 * Renders a tool-call args object into a safe approval-prompt summary.
 * Shows top-level KEYS only — never values — because args may carry
 * secrets (API keys, passwords, tokens, recipient PII). Byte-for-byte
 * identical to Discord's implementation; deliberate consistency across
 * adapters. Filed as BFW-014 "extract `summarizeArgsForApproval` to
 * adapters/common.ts" when the third identical copy ships.
 */
function summarizeArgsForApproval(args: Readonly<Record<string, unknown>>): string {
  const keys = Object.keys(args);
  if (keys.length === 0) return '(no arguments)';
  const summary = `Argument keys: ${keys.join(', ')}`;
  return summary.length > APPROVAL_ARGS_PREVIEW_MAX
    ? summary.slice(0, APPROVAL_ARGS_PREVIEW_MAX - 1) + '\u2026'
    : summary;
}

interface PendingApproval {
  readonly resolve: (decision: streaming.ApprovalDecision) => void;
}

export class SlackEditStreamingAdapter {
  readonly #web: WebClientSurface;
  readonly #channel: string;
  readonly #debounceMs: number;
  readonly #fetchImpl: typeof fetch;
  readonly #pending = new Map<string, PendingApproval>();

  constructor(opts: SlackAdapterOptions) {
    this.#web = opts.web;
    this.#channel = opts.channel;
    this.#debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#fetchImpl =
      opts.fetchImpl ??
      (((url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        globalThis.fetch(url, init)) as typeof fetch);
  }

  /**
   * Slice of `SessionOptions` the adapter owns. Caller combines with
   * target + streamSink + approvalResolver (via `approvalResolver()`).
   */
  sessionOptions(): Pick<
    SessionOptions,
    'editFn' | 'sendFn' | 'finalFormatEdit' | 'maxMessageBytes' | 'debounceMs'
  > {
    return {
      editFn: this.#editFn,
      sendFn: this.#sendFn,
      finalFormatEdit: this.#finalFormatEdit,
      maxMessageBytes: SLACK_BYTE_CAP,
      debounceMs: this.#debounceMs,
    };
  }

  approvalResolver(): ApprovalResolver {
    return async (preview) => {
      const approvalId = preview.approvalId;
      const blocks = [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Tool call: ${preview.toolName}*` },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: summarizeArgsForApproval(preview.args) },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Approve' },
              style: 'primary',
              action_id: CB_PREFIX_APPROVE + approvalId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Reject' },
              style: 'danger',
              action_id: CB_PREFIX_REJECT + approvalId,
            },
          ],
        },
      ];
      try {
        await this.#web.chat.postMessage({
          channel: this.#channel,
          text: `Tool call approval: ${preview.toolName}`,
          blocks,
        });
      } catch (err) {
        // Can't post the prompt — the gate can't be resolved by a tap.
        // Surface as rejection so the session moves on rather than
        // hanging until timeout. Mirrors PR #9 / PR #10 UX.
        return {
          approvalId,
          approved: false,
          reason: `prompt-post-failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      try {
        return await new Promise<streaming.ApprovalDecision>((resolve) => {
          this.#pending.set(approvalId, { resolve });
        });
      } finally {
        this.#pending.delete(approvalId);
      }
    };
  }

  /**
   * Slack interactivity handler. Wire into whatever path delivers
   * `block_actions` payloads (Bolt: `app.action({type: 'block_actions'},
   * ({body}) => adapter.onInteraction(body))`; raw HTTP: the parsed POST
   * body; tests: a `ParsedSlackInteraction` directly).
   */
  readonly onInteraction = async (input: unknown): Promise<void> => {
    const parsed = isParsedSlackInteraction(input) ? input : parseBlockActionsPayload(input);
    if (!parsed) return;
    const { actionId, responseUrl } = parsed;
    let approvalId: string;
    let approved: boolean;
    if (actionId.startsWith(CB_PREFIX_APPROVE)) {
      approvalId = actionId.slice(CB_PREFIX_APPROVE.length);
      approved = true;
    } else if (actionId.startsWith(CB_PREFIX_REJECT)) {
      approvalId = actionId.slice(CB_PREFIX_REJECT.length);
      approved = false;
    } else {
      return; // not ours
    }
    const entry = this.#pending.get(approvalId);
    // Cleanup the prompt via response_url (DECISION 11-C). Fire-and-forget
    // on failure — a failed strip doesn't change the approval outcome.
    // The promise must still be AWAITED so tests can observe the cleanup
    // before asserting; the await races fetch against the decision
    // resolution but doesn't hold the latter hostage.
    await this.#postResponseUrl(responseUrl).catch(() => {
      /* swallow */
    });
    if (!entry) return; // late tap after cleanup — silent no-op
    entry.resolve({ approvalId, approved });
  };

  /** @internal — test only. Do not use outside tests. Probes the in-flight approval count. */
  _debugPendingCount(): number {
    return this.#pending.size;
  }

  async #postResponseUrl(url: string): Promise<void> {
    await this.#fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        replace_original: true,
        blocks: [],
        text: 'Tool call decision recorded',
      }),
    });
  }

  // ─── Callbacks wired into SessionOptions ───────────────────────────

  readonly #editFn: EditFn = async (messageId, text) => {
    try {
      await this.#web.chat.update({
        channel: this.#channel,
        ts: messageId,
        text,
      });
    } catch (err) {
      const c = classifySlackError(err);
      switch (c.kind) {
        case 'classified':
          throw c.error;
        case 'absorb':
          // DECISION 11-F: unreachable per invariant (test T-22). Silent
          // return matches Telegram's absorb-as-success semantics for
          // editFn-shaped callsites.
          return;
        case 'unknown':
          throw err;
      }
    }
  };

  readonly #sendFn: SendFn = async (text) => {
    try {
      const result = await this.#web.chat.postMessage({
        channel: this.#channel,
        text,
      });
      const ts = result.ts;
      if (typeof ts !== 'string' || ts.length === 0) {
        throw new Error(
          `[SlackEditStreamingAdapter] chat.postMessage returned ok without ts: ${JSON.stringify(result)}`,
        );
      }
      return ts;
    } catch (err) {
      const c = classifySlackError(err);
      switch (c.kind) {
        case 'classified':
          throw c.error;
        case 'absorb':
          // DECISION 11-F: Slack has no known error that classifies as
          // absorb. If this fires, the classifier has drifted and T-22
          // is broken. Fail loudly rather than returning a bogus ts —
          // a downstream chat.update(channel, '', text) would paper
          // over the failure. (PR #10 round-1 pattern, identical
          // message template for cross-adapter grep consistency.)
          throw new Error(
            `[SlackEditStreamingAdapter] sendFn hit absorb branch — ` +
              `DECISION 11-F invariant violated. Original error: ${String(err)}`,
          );
        case 'unknown':
          throw err;
      }
    }
  };

  readonly #finalFormatEdit = async (messageId: string, text: string): Promise<void> => {
    const escaped = escapeSlackMrkdwn(text);
    try {
      await this.#web.chat.update({
        channel: this.#channel,
        ts: messageId,
        text: escaped,
        mrkdwn: true,
      });
      return;
    } catch (err) {
      const c = classifySlackError(err);
      switch (c.kind) {
        case 'classified':
          if (c.error.kind === 'parse-error') {
            // Plain-text fallback (DECISION 11-B + PR #8 DECISION 1).
            // Retry ONCE with the un-escaped original text and no mrkdwn
            // flag, so the user sees content rather than a dropped
            // terminal edit if Slack rejects our escaped payload.
            try {
              await this.#web.chat.update({
                channel: this.#channel,
                ts: messageId,
                text,
              });
              return;
            } catch (err2) {
              const c2 = classifySlackError(err2);
              switch (c2.kind) {
                case 'classified':
                  throw c2.error;
                case 'absorb':
                  return;
                case 'unknown':
                  throw err2;
              }
            }
          }
          throw c.error;
        case 'absorb':
          return;
        case 'unknown':
          throw err;
      }
    }
  };
}
