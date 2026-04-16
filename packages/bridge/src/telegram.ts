/**
 * Telegram bridge — built on grammY.
 *
 * Scope: listens for text messages + callback queries (inline-button presses),
 * maps them to IncomingMessage, and sends text + inline keyboards back.
 *
 * Grammy's `Bot` is injectable via `bot` option so tests can substitute a
 * fake with just the methods we touch: `on`, `start`, `stop`, `api.sendMessage`,
 * and `api.answerCallbackQuery`. The bridge itself doesn't depend on the
 * underlying long-polling / webhook transport choice.
 */

import { Bot, InlineKeyboard, type Context } from 'grammy';
import {
  Hipp0BridgeNotConnectedError,
  Hipp0BridgeSendError,
  type BridgeCapabilities,
  type ErrorHandler,
  type IncomingMessage,
  type MessageBridge,
  type MessageHandler,
  type OutgoingButton,
  type OutgoingMessage,
} from './types.js';

const TELEGRAM_PLATFORM = 'telegram' as const;

export interface TelegramBridgeOptions {
  /** Bot token. Falls back to TELEGRAM_BOT_TOKEN env var. */
  token?: string;
  adminUserIds?: readonly (string | number)[];
  /** Injected Bot instance for tests. */
  bot?: Bot;
}

export class TelegramBridge implements MessageBridge {
  readonly platform = TELEGRAM_PLATFORM;
  private bot: Bot | undefined;
  private connected = false;
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private admins: Set<string>;

  constructor(private readonly opts: TelegramBridgeOptions = {}) {
    this.admins = new Set((opts.adminUserIds ?? []).map(String));
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    const token = this.opts.token ?? process.env.TELEGRAM_BOT_TOKEN;
    if (!token && !this.opts.bot) {
      throw new Error(
        'TelegramBridge: token not provided (pass `token` or set TELEGRAM_BOT_TOKEN).',
      );
    }
    const bot = this.opts.bot ?? new Bot(token ?? 'injected');
    this.bot = bot;

    bot.on('message:text', (ctx) => this.handleText(ctx));
    bot.on('callback_query:data', (ctx) => this.handleCallback(ctx));
    bot.catch((err) => this.emitError(err));

    // `start()` returns only after long-polling stops. Fire-and-forget.
    void bot.start({ drop_pending_updates: true }).catch((err) => this.emitError(err));
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    try {
      await this.bot?.stop();
    } catch {
      /* ignore */
    }
    this.bot = undefined;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  async send(channelId: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected || !this.bot) {
      throw new Hipp0BridgeNotConnectedError(TELEGRAM_PLATFORM);
    }
    const reply_markup = buildInlineKeyboard(content.buttons);
    try {
      await this.bot.api.sendMessage(channelId, content.text, {
        ...(reply_markup && { reply_markup }),
        ...(content.replyTo && {
          reply_parameters: { message_id: Number(content.replyTo) },
        }),
      });
    } catch (err) {
      throw new Hipp0BridgeSendError(TELEGRAM_PLATFORM, err);
    }
  }

  getCapabilities(): BridgeCapabilities {
    return {
      files: true,
      buttons: true,
      threads: false,
      slashCommands: true,
      maxMessageBytes: 4096,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────

  private handleText(ctx: Context): void {
    const msg = ctx.message;
    const from = ctx.from;
    if (!msg || !from) return;
    const incoming: IncomingMessage = {
      platform: TELEGRAM_PLATFORM,
      id: String(msg.message_id),
      channel: {
        id: String(msg.chat.id),
        ...('title' in msg.chat && msg.chat.title && { name: msg.chat.title }),
        isDM: msg.chat.type === 'private',
      },
      user: {
        id: String(from.id),
        name: from.username ?? from.first_name ?? `tg:${from.id}`,
        isAdmin: this.admins.has(String(from.id)),
      },
      text: msg.text ?? '',
      timestamp: msg.date * 1000,
      ...(msg.reply_to_message?.message_id && {
        replyTo: String(msg.reply_to_message.message_id),
      }),
    };
    this.dispatch(incoming);
  }

  private handleCallback(ctx: Context): void {
    const cb = ctx.callbackQuery;
    const from = ctx.from;
    if (!cb || !from || !ctx.chat) return;
    const incoming: IncomingMessage = {
      platform: TELEGRAM_PLATFORM,
      id: `cb:${cb.id}`,
      channel: { id: String(ctx.chat.id), isDM: ctx.chat.type === 'private' },
      user: {
        id: String(from.id),
        name: from.username ?? from.first_name ?? `tg:${from.id}`,
        isAdmin: this.admins.has(String(from.id)),
      },
      text: 'data' in cb ? ((cb.data as string | undefined) ?? '') : '',
      timestamp: Date.now(),
      platformData: { frameType: 'callback_query' },
    };
    this.dispatch(incoming);
    // Acknowledge so the client stops the loading spinner.
    void ctx.answerCallbackQuery().catch((err: unknown) => this.emitError(err));
  }

  private dispatch(msg: IncomingMessage): void {
    for (const h of this.handlers) {
      try {
        const r = h(msg);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch((err) => this.emitError(err));
        }
      } catch (err) {
        this.emitError(err);
      }
    }
  }

  private emitError(err: unknown): void {
    for (const h of this.errorHandlers) {
      try {
        h(err);
      } catch {
        /* swallow */
      }
    }
  }
}

function buildInlineKeyboard(buttons?: readonly OutgoingButton[]): InlineKeyboard | undefined {
  if (!buttons || buttons.length === 0) return undefined;
  const kb = new InlineKeyboard();
  for (const b of buttons) kb.text(b.label, b.value);
  return kb;
}
