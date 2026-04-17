/**
 * Discord edit-streaming adapter — second consumer of `StreamingEditSession`
 * (PR #8 shared infra). See CLAUDE.md Phase G2-b adapters DECISIONs for
 * Discord-specific rationale (DECISION 10-A through 10-H).
 *
 * Responsibilities mirror the Telegram adapter (PR #9):
 *   - Produce the `editFn` / `sendFn` callbacks the session expects, against
 *     a discord.js v14 `Client` + channel id.
 *   - Classify discord.js REST errors into `StreamingEditError` kinds so the
 *     session's rate-limit / transient / permanent handling fires correctly.
 *   - Provide an `ApprovalResolver` that posts a separate embed + button
 *     prompt and resolves on the matching `ButtonInteraction`.
 *   - Clean up approval Map entries regardless of the gate's outcome
 *     (PR #8 DECISION 4 AFFECTS).
 *
 * Differences from Telegram (PR #9):
 *   - No `finalFormatEdit` hook — Discord accepts standard markdown during
 *     streaming edits, so the terminal re-edit is unnecessary (DECISION 10-B).
 *   - Approval prompt is a SEPARATE message with `EmbedBuilder` + `ActionRow`,
 *     not an `inline_keyboard` on the streaming message (DECISION 10-C). The
 *     stream message is never touched by the approval flow.
 *   - Error classifier returns a discriminated union `ClassifiedError` rather
 *     than `StreamingEditError | 'absorb' | null` — applies PR #9 review
 *     lesson #2 so call sites become exhaustive `switch` (DECISION 10-E).
 *   - Channel handle is resolved lazily + memoized via `#getChannel()` so the
 *     constructor stays sync and the adapter survives transient outages
 *     (DECISION 10-H3).
 *
 * The adapter is a thin factory — it doesn't own the `Client` lifecycle or
 * the `DiscordBridge`. The bridge's owner wires
 * `client.on('interactionCreate', adapter.onInteraction)` once at startup;
 * the adapter handles all edit-streaming concerns.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  DiscordAPIError,
  EmbedBuilder,
  HTTPError,
  RateLimitError,
  type ButtonInteraction,
  type Client,
  type Interaction,
  type TextBasedChannel,
} from 'discord.js';

import type { streaming } from '@openhipp0/core';

import {
  StreamingEditError,
  type ApprovalResolver,
  type EditErrorKind,
  type EditFn,
  type SendFn,
  type SessionOptions,
} from '../types.js';

const DISCORD_CHAR_CAP = 2000;
const DEFAULT_DEBOUNCE_MS = 200;
const APPROVAL_ARGS_PREVIEW_MAX = 200;

/** Custom-id prefixes keep our buttons distinguishable from others. */
const CB_PREFIX_APPROVE = 'hipp0-approve:';
const CB_PREFIX_REJECT = 'hipp0-reject:';

/**
 * Discord error codes (numeric `DiscordAPIError.code`) that always indicate
 * the resource is gone or the bot lacks permission — never recoverable by
 * retry. See https://discord.com/developers/docs/topics/opcodes-and-status-codes.
 */
const PERMANENT_DISCORD_CODES = new Set<number>([
  10003, // Unknown Channel
  10008, // Unknown Message
  50001, // Missing Access
  50013, // Missing Permissions
]);

export interface DiscordAdapterOptions {
  readonly client: Client;
  readonly channelId: string;
  /** Defaults to 200ms per DECISION 10-G. */
  readonly debounceMs?: number;
}

/**
 * Narrow shape the adapter actually consumes off a `ButtonInteraction`.
 * Tests construct this directly; production callers can pass either the
 * full discord.js `Interaction` (parsed via `parseButtonInteraction`) or
 * the parsed shape (recognized via `isParsedInteraction`). DECISION 10-D.
 */
export interface ParsedInteraction {
  readonly customId: string;
  /**
   * Acks the button tap and updates the prompt message. Used to strip the
   * `components: []` after a decision so the buttons can't be tapped again.
   */
  readonly update: (payload: { components?: unknown[]; embeds?: unknown[] }) => Promise<unknown>;
}

/**
 * Discriminated union returned by `classifyDiscordError`. PR #9 lesson #2:
 * exhaustive `switch (result.kind)` at every call site, no `instanceof`
 * narrowing, no `null` sentinels.
 *
 *   'classified' → rethrow `error` (session routes per `kind`)
 *   'absorb'     → swallow silently. NOTE: Discord has no known error that
 *                  reaches this branch — editing to identical content is a
 *                  no-op success, not an error. Retained for parity with
 *                  Telegram's classifier so downstream callers can use a
 *                  single `switch (kind)` regardless of bridge. Test #23
 *                  enforces that no fixture in `__fixtures__/discord-errors.json`
 *                  ever returns `'absorb'`.
 *   'unknown'    → unrecognized shape (non-Error throw); caller should
 *                  rethrow the original.
 */
export type ClassifiedError =
  | { readonly kind: 'classified'; readonly error: StreamingEditError }
  | { readonly kind: 'absorb' }
  | { readonly kind: 'unknown' };

/**
 * Discriminates the parsed shape from a full discord.js `Interaction`. The
 * load-bearing check is `!('isButton' in x)` — every `Interaction` subtype
 * carries the `isButton` method (returning true on `ButtonInteraction`,
 * false elsewhere); the parsed shape is intentionally narrow and does not.
 * Mirrors PR #9's `isParsedCallbackQuery` pattern (named guard, single
 * coupling site) — PR #9 lesson #3.
 */
export function isParsedInteraction(x: unknown): x is ParsedInteraction {
  return (
    typeof x === 'object' &&
    x !== null &&
    'customId' in x &&
    typeof (x as ParsedInteraction).customId === 'string' &&
    'update' in x &&
    typeof (x as ParsedInteraction).update === 'function' &&
    !('isButton' in x)
  );
}

/**
 * Pulls the fields we need off a discord.js `Interaction`. Returns `null`
 * for non-button interactions (chat-input, autocomplete, modal-submit, etc.)
 * and for malformed inputs. Isolated so tests don't have to construct a
 * full discord.js `ButtonInteraction`.
 *
 * Contract: accepts only a discord.js `Interaction` (with `isButton()`).
 * Callers holding an already-parsed shape should dispatch via
 * `isParsedInteraction` first — see `onInteraction` for the canonical
 * routing. Passing a `ParsedInteraction` directly here returns `null`.
 */
export function parseButtonInteraction(input: unknown): ParsedInteraction | null {
  if (typeof input !== 'object' || input === null) return null;
  const i = input as Partial<ButtonInteraction> & { isButton?: () => boolean };
  if (typeof i.isButton !== 'function' || !i.isButton()) return null;
  if (typeof i.customId !== 'string') return null;
  if (typeof i.update !== 'function') return null;
  const updateBound = i.update.bind(i) as ParsedInteraction['update'];
  return { customId: i.customId, update: updateBound };
}

function makeClassified(kind: EditErrorKind, message: string, cause: unknown): ClassifiedError {
  return {
    kind: 'classified',
    error: new StreamingEditError(kind, message, { cause }),
  };
}

/**
 * Classifies a discord.js REST error into the session's error vocabulary.
 * Single site, exhaustive, safe default of `'transient'` for unknown Error
 * shapes (next tick retries) — matches PR #9's classifier philosophy.
 *
 * Mapping:
 *   - `RateLimitError`               → rate-limit, `retryAfterMs = err.retryAfter`
 *                                      (discord.js exposes ms; do NOT × 1000).
 *   - `DiscordAPIError` code in {10003, 10008, 50001, 50013}
 *                                    → permanent
 *   - `DiscordAPIError` status 401/403/404
 *                                    → permanent
 *   - `DiscordAPIError` status 429   → rate-limit (covers the rare path
 *                                      where the SDK's auto-retry surfaced
 *                                      a 429 as a plain DiscordAPIError;
 *                                      `retry_after` on `rawError` is in
 *                                      seconds per Discord JSON spec).
 *   - `DiscordAPIError` other 5xx    → transient
 *   - `HTTPError` status 401/403/404 → permanent
 *   - `HTTPError` status 5xx         → transient
 *   - `Error` with `code` in {ECONNRESET, ETIMEDOUT, ENETUNREACH, EAI_AGAIN}
 *                                    → transient
 *   - any other `Error`              → transient (safe default)
 *   - non-Error throw                → `{ kind: 'unknown' }`
 */
export function classifyDiscordError(err: unknown): ClassifiedError {
  if (err instanceof RateLimitError) {
    return {
      kind: 'classified',
      error: new StreamingEditError(
        'rate-limit',
        `Discord rate-limit on ${err.method} ${err.url}`,
        { retryAfterMs: err.retryAfter, cause: err },
      ),
    };
  }
  if (err instanceof DiscordAPIError) {
    const codeNum = typeof err.code === 'number' ? err.code : Number(err.code);
    if (Number.isFinite(codeNum) && PERMANENT_DISCORD_CODES.has(codeNum)) {
      return makeClassified('permanent', `Discord ${codeNum}: ${err.message}`, err);
    }
    if (err.status === 401 || err.status === 403 || err.status === 404) {
      return makeClassified('permanent', `Discord ${err.status}: ${err.message}`, err);
    }
    if (err.status === 429) {
      const raw = err.rawError as { retry_after?: number } | undefined;
      const retryAfterMs =
        raw && typeof raw.retry_after === 'number' ? raw.retry_after * 1000 : undefined;
      return {
        kind: 'classified',
        error: new StreamingEditError(
          'rate-limit',
          `Discord 429: ${err.message}`,
          retryAfterMs !== undefined ? { retryAfterMs, cause: err } : { cause: err },
        ),
      };
    }
    return makeClassified('transient', `Discord ${err.status}: ${err.message}`, err);
  }
  if (err instanceof HTTPError) {
    if (err.status === 401 || err.status === 403 || err.status === 404) {
      return makeClassified('permanent', `Discord HTTP ${err.status}: ${err.message}`, err);
    }
    return makeClassified('transient', `Discord HTTP ${err.status}: ${err.message}`, err);
  }
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    if (
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ENETUNREACH' ||
      code === 'EAI_AGAIN'
    ) {
      return makeClassified('transient', `Network: ${err.message}`, err);
    }
    return makeClassified('transient', err.message, err);
  }
  return { kind: 'unknown' };
}

/**
 * Renders a tool-call args object into a safe approval-prompt summary.
 * Shows top-level KEYS only — never values — because args may carry secrets
 * (API keys, passwords, tokens, recipient PII). Operators wanting richer
 * previews can supply a `summary` on the `ToolCallPreviewEvent` itself
 * (we surface it; tools own the safety contract for their summary string).
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

export class DiscordEditStreamingAdapter {
  readonly #client: Client;
  readonly #channelId: string;
  readonly #debounceMs: number;
  readonly #pending = new Map<string, PendingApproval>();
  #channelPromise: Promise<TextBasedChannel & { send: (...args: unknown[]) => Promise<unknown> }> | null = null;

  constructor(opts: DiscordAdapterOptions) {
    this.#client = opts.client;
    this.#channelId = opts.channelId;
    this.#debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /**
   * Slice of `SessionOptions` the adapter owns. Caller combines with
   * target + streamSink + approvalResolver (via `approvalResolver()`).
   * Note: no `finalFormatEdit` — DECISION 10-B (Discord accepts standard
   * markdown during streaming; no MarkdownV2-style handshake required).
   */
  sessionOptions(): Pick<
    SessionOptions,
    'editFn' | 'sendFn' | 'maxMessageBytes' | 'debounceMs'
  > {
    return {
      editFn: this.#editFn,
      sendFn: this.#sendFn,
      maxMessageBytes: DISCORD_CHAR_CAP,
      debounceMs: this.#debounceMs,
    };
  }

  approvalResolver(): ApprovalResolver {
    return async (preview) => {
      const approvalId = preview.approvalId;
      const embed = new EmbedBuilder()
        .setTitle(`Tool call: ${preview.toolName}`)
        .setDescription(summarizeArgsForApproval(preview.args));
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(CB_PREFIX_APPROVE + approvalId)
          .setLabel('Approve')
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(CB_PREFIX_REJECT + approvalId)
          .setLabel('Reject')
          .setStyle(ButtonStyle.Danger),
      );
      try {
        const channel = await this.#getChannel();
        await channel.send({ embeds: [embed], components: [row] });
      } catch (err) {
        // Can't post the prompt — the gate can't be resolved by a tap.
        // Surface as rejection so the session moves on rather than
        // hanging until timeout. Mirrors PR #9 prompt-post-failed UX.
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
   * discord.js handler. Wire
   * `client.on('interactionCreate', adapter.onInteraction)`. Accepts either
   * a full `Interaction` (production path) or a `ParsedInteraction` (test
   * path) — discriminated by `isParsedInteraction`.
   */
  readonly onInteraction = async (input: Interaction | ParsedInteraction): Promise<void> => {
    const parsed = isParsedInteraction(input) ? input : parseButtonInteraction(input);
    if (!parsed) return;
    const { customId } = parsed;
    let approvalId: string;
    let approved: boolean;
    if (customId.startsWith(CB_PREFIX_APPROVE)) {
      approvalId = customId.slice(CB_PREFIX_APPROVE.length);
      approved = true;
    } else if (customId.startsWith(CB_PREFIX_REJECT)) {
      approvalId = customId.slice(CB_PREFIX_REJECT.length);
      approved = false;
    } else {
      return; // not ours
    }
    const entry = this.#pending.get(approvalId);
    // Ack the tap by stripping `components: []` — same call serves both
    // "ack so the user doesn't see an interaction-failed banner" and
    // "remove the buttons so they can't be tapped again." Fire-and-forget;
    // a failed ack doesn't change the approval outcome.
    try {
      await parsed.update({ components: [] });
    } catch {
      /* swallow */
    }
    if (!entry) return; // late tap after cleanup — DECISION 10-C silent no-op
    entry.resolve({ approvalId, approved });
  };

  /** @internal — test only. Do not use outside tests. Probes the in-flight approval count. */
  _debugPendingCount(): number {
    return this.#pending.size;
  }

  async #getChannel(): Promise<
    TextBasedChannel & { send: (...args: unknown[]) => Promise<unknown> }
  > {
    if (!this.#channelPromise) {
      this.#channelPromise = (async () => {
        const ch = await this.#client.channels.fetch(this.#channelId);
        if (!ch || !('send' in ch) || typeof (ch as { send?: unknown }).send !== 'function') {
          throw new Error(`Discord channel not sendable: ${this.#channelId}`);
        }
        return ch as TextBasedChannel & { send: (...args: unknown[]) => Promise<unknown> };
      })();
    }
    return this.#channelPromise;
  }

  // ─── Callbacks wired into SessionOptions ───────────────────────────

  readonly #editFn: EditFn = async (messageId, text) => {
    try {
      const channel = await this.#getChannel();
      const ch = channel as unknown as {
        messages: { fetch: (id: string) => Promise<{ edit: (text: string) => Promise<unknown> }> };
      };
      const msg = await ch.messages.fetch(messageId);
      await msg.edit(text);
    } catch (err) {
      const c = classifyDiscordError(err);
      switch (c.kind) {
        case 'classified':
          throw c.error;
        case 'absorb':
          // DECISION 10-F: unreachable per invariant (test #23). Falls
          // through to silent success if the invariant ever breaks,
          // matching Telegram absorb semantics for consistency.
          return;
        case 'unknown':
          throw err;
      }
    }
  };

  readonly #sendFn: SendFn = async (text) => {
    try {
      const channel = await this.#getChannel();
      const sent = (await channel.send(text)) as { id: string };
      return sent.id;
    } catch (err) {
      const c = classifyDiscordError(err);
      switch (c.kind) {
        case 'classified':
          throw c.error;
        case 'absorb':
          // DECISION 10-F: Discord has no known error that classifies
          // as absorb. If this fires, the classifier has drifted and
          // the invariant (test #23) is broken. Fail loudly rather
          // than silently emitting a bogus message id — a downstream
          // editFn('', text) call would paper over the failure.
          throw new Error(
            `[DiscordEditStreamingAdapter] sendFn hit absorb branch — ` +
              `DECISION 10-F invariant violated. Original error: ${String(err)}`,
          );
        case 'unknown':
          throw err;
      }
    }
  };
}
