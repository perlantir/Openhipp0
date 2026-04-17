/**
 * Telegram edit-streaming adapter — first consumer of
 * `StreamingEditSession` (PR #8 shared infra). See CLAUDE.md Phase
 * G2-b adapters DECISIONs for rationale.
 *
 * Responsibilities:
 *   - Produce the `editFn` / `sendFn` / `finalFormatEdit` callbacks
 *     the session expects, against a grammY `Bot` handle.
 *   - Classify Bot API errors into `StreamingEditError` kinds so the
 *     session's rate-limit / transient / parse-error / permanent
 *     handling fires correctly.
 *   - Provide an `ApprovalResolver` that renders a 2-button
 *     inline_keyboard and resolves on matching `callback_query`.
 *   - Clean up approval Map entries + button keyboards regardless
 *     of the gate's outcome (DECISION 4 AFFECTS).
 *
 * The adapter is a thin factory — it doesn't own the `Bot` lifecycle
 * or the `TelegramBridge`. The bridge's owner wires
 * `bot.on('callback_query:data', adapter.onCallbackQuery)` once at
 * startup; the adapter handles all edit-streaming concerns.
 */

import type { Bot, Context } from 'grammy';
import { GrammyError, InlineKeyboard } from 'grammy';

import type { streaming } from '@openhipp0/core';

import {
  StreamingEditError,
  type ApprovalResolver,
  type EditFn,
  type SendFn,
  type SessionOptions,
} from '../types.js';

import { escapeMarkdownV2 } from './telegram-markdown.js';

const TELEGRAM_CHAR_CAP = 4096;
const DEFAULT_DEBOUNCE_MS = 1000;

/** Callback-data prefixes keep our buttons distinguishable from others. */
const CB_PREFIX_APPROVE = 'hipp0-approve:';
const CB_PREFIX_REJECT = 'hipp0-reject:';

export interface TelegramAdapterOptions {
  readonly bot: Bot;
  readonly chatId: number | string;
  /** Defaults to 1000ms per Phase G2-b. */
  readonly debounceMs?: number;
}

interface PendingApproval {
  readonly resolve: (decision: streaming.ApprovalDecision) => void;
  readonly promptMessageId: number;
}

export interface ParsedCallbackQuery {
  readonly data: string;
  readonly id: string;
}

/**
 * Pulls the fields we need off a grammY `Context` / `CallbackQuery`.
 * Isolated so tests don't have to construct a full grammY context.
 */
export function parseCallbackQuery(
  input: ParsedCallbackQuery | { callbackQuery?: { data?: string; id?: string } },
): ParsedCallbackQuery | null {
  if ('data' in input && 'id' in input) {
    return { data: input.data, id: input.id };
  }
  const cb = input.callbackQuery;
  if (!cb || typeof cb.data !== 'string' || typeof cb.id !== 'string') return null;
  return { data: cb.data, id: cb.id };
}

/**
 * Maps a Bot API error into the `StreamingEditError` taxonomy the
 * session consumes. Returns `null` if the caller should absorb the
 * error silently (e.g. "message is not modified" — DECISION 2).
 */
export function classifyTelegramError(err: unknown): StreamingEditError | 'absorb' | null {
  if (err instanceof GrammyError) {
    const code = err.error_code;
    const desc = err.description;
    if (code === 429) {
      const ra = err.parameters?.retry_after;
      const retryAfterMs = typeof ra === 'number' ? ra * 1000 : undefined;
      return new StreamingEditError(
        'rate-limit',
        `Telegram 429: ${desc}`,
        retryAfterMs !== undefined ? { retryAfterMs, cause: err } : { cause: err },
      );
    }
    if (code === 400) {
      // "message is not modified" — debouncer re-fired with identical
      // text. Treat as success, not error. DECISION 2.
      if (desc.includes('message is not modified')) {
        return 'absorb';
      }
      if (
        desc.includes("can't parse entities") ||
        desc.includes("can't find end") ||
        desc.includes('MarkdownV2') ||
        desc.toLowerCase().includes('entity')
      ) {
        return new StreamingEditError('parse-error', `Telegram 400: ${desc}`, { cause: err });
      }
      if (
        desc.includes('message to edit not found') ||
        desc.includes('chat not found') ||
        desc.includes('message_id_invalid')
      ) {
        return new StreamingEditError('permanent', `Telegram 400: ${desc}`, { cause: err });
      }
      // Unknown 400: conservative transient (next tick retries).
      return new StreamingEditError('transient', `Telegram 400: ${desc}`, { cause: err });
    }
    if (code === 403) {
      return new StreamingEditError('permanent', `Telegram 403: ${desc}`, { cause: err });
    }
    if (code >= 500) {
      return new StreamingEditError('transient', `Telegram ${code}: ${desc}`, { cause: err });
    }
    return new StreamingEditError('transient', `Telegram ${code}: ${desc}`, { cause: err });
  }
  // Network-level errors (HttpError wraps fetch failures; plain Error
  // with known codes). Treat all unclassified errors as transient.
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    if (
      code === 'ECONNRESET' ||
      code === 'ETIMEDOUT' ||
      code === 'ENETUNREACH' ||
      code === 'EAI_AGAIN'
    ) {
      return new StreamingEditError('transient', `Network: ${err.message}`, { cause: err });
    }
    return new StreamingEditError('transient', err.message, { cause: err });
  }
  return null;
}

export class TelegramEditStreamingAdapter {
  readonly #bot: Bot;
  readonly #chatId: number | string;
  readonly #debounceMs: number;
  readonly #pending = new Map<string, PendingApproval>();

  constructor(opts: TelegramAdapterOptions) {
    this.#bot = opts.bot;
    this.#chatId = opts.chatId;
    this.#debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
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
      maxMessageBytes: TELEGRAM_CHAR_CAP,
      debounceMs: this.#debounceMs,
    };
  }

  approvalResolver(): ApprovalResolver {
    return async (preview) => {
      const approvalId = preview.approvalId;
      let promptMessageId: number;
      const kb = new InlineKeyboard()
        .text('Approve', CB_PREFIX_APPROVE + approvalId)
        .text('Reject', CB_PREFIX_REJECT + approvalId);
      const promptText = `Tool call: ${preview.toolName}\nApprove?`;
      try {
        const sent = await this.#bot.api.sendMessage(this.#chatId, promptText, {
          reply_markup: kb,
        });
        promptMessageId = sent.message_id;
      } catch (err) {
        // Can't post the prompt — the gate can't be resolved by a tap.
        // Surface as rejection so the session moves on rather than
        // hanging until timeout.
        return {
          approvalId,
          approved: false,
          reason: `prompt-post-failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      try {
        return await new Promise<streaming.ApprovalDecision>((resolve) => {
          this.#pending.set(approvalId, { resolve, promptMessageId });
        });
      } finally {
        this.#cleanup(approvalId);
      }
    };
  }

  /** grammY handler. Wire `bot.on('callback_query:data', adapter.onCallbackQuery)`. */
  readonly onCallbackQuery = async (input: Context | ParsedCallbackQuery): Promise<void> => {
    const parsed =
      'data' in input && 'id' in input && typeof (input as ParsedCallbackQuery).data === 'string'
        ? (input as ParsedCallbackQuery)
        : parseCallbackQuery(input as Context);
    if (!parsed) return;
    const { data, id } = parsed;
    let approvalId: string;
    let approved: boolean;
    if (data.startsWith(CB_PREFIX_APPROVE)) {
      approvalId = data.slice(CB_PREFIX_APPROVE.length);
      approved = true;
    } else if (data.startsWith(CB_PREFIX_REJECT)) {
      approvalId = data.slice(CB_PREFIX_REJECT.length);
      approved = false;
    } else {
      return; // not ours
    }
    const entry = this.#pending.get(approvalId);
    // Ack the tap so the client stops its loading spinner. Fire-and-
    // forget; if ack fails, the approval flow has already resolved.
    try {
      await this.#bot.api.answerCallbackQuery(id);
    } catch {
      /* ignore */
    }
    if (!entry) return; // late tap after cleanup — DECISION 4 silent no-op
    entry.resolve({ approvalId, approved });
  };

  #cleanup(approvalId: string): void {
    const entry = this.#pending.get(approvalId);
    if (!entry) return;
    this.#pending.delete(approvalId);
    // Strip the inline_keyboard so the buttons can't be tapped after
    // the gate resolved (timeout, resolver error, or normal tap).
    // Fire-and-forget — a failed edit doesn't change the approval
    // outcome, and Telegram will eventually GC the stale buttons.
    void this.#bot.api
      .editMessageReplyMarkup(this.#chatId, entry.promptMessageId, { reply_markup: undefined })
      .catch(() => {
        /* swallow */
      });
  }

  // ─── Callbacks wired into SessionOptions ───────────────────────────

  readonly #editFn: EditFn = async (messageId, text) => {
    try {
      await this.#bot.api.editMessageText(this.#chatId, Number(messageId), text);
    } catch (err) {
      const classified = classifyTelegramError(err);
      if (classified === 'absorb') return; // silent no-op
      if (classified instanceof StreamingEditError) throw classified;
      throw err;
    }
  };

  readonly #sendFn: SendFn = async (text) => {
    const sent = await this.#bot.api.sendMessage(this.#chatId, text);
    return String(sent.message_id);
  };

  readonly #finalFormatEdit = async (messageId: string, text: string): Promise<void> => {
    const escaped = escapeMarkdownV2(text);
    try {
      await this.#bot.api.editMessageText(this.#chatId, Number(messageId), escaped, {
        parse_mode: 'MarkdownV2',
      });
      return;
    } catch (err) {
      const classified = classifyTelegramError(err);
      if (classified === 'absorb') return;
      if (classified instanceof StreamingEditError && classified.kind === 'parse-error') {
        // Plain-text fallback (DECISION 1 from PR #8). Retry ONCE.
        try {
          await this.#bot.api.editMessageText(this.#chatId, Number(messageId), text);
          return;
        } catch (err2) {
          const c2 = classifyTelegramError(err2);
          if (c2 === 'absorb') return;
          if (c2 instanceof StreamingEditError) throw c2;
          throw err2;
        }
      }
      if (classified instanceof StreamingEditError) throw classified;
      throw err;
    }
  };
}
