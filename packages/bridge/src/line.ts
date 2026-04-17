/**
 * LINE Messaging API bridge — webhook in, REST out. Uses reply() when
 * a fresh replyToken is available, else pushText().
 */

import {
  Hipp0BridgeNotConnectedError,
  Hipp0BridgeSendError,
  type BridgeCapabilities,
  type ErrorHandler,
  type IncomingMessage,
  type MessageBridge,
  type MessageHandler,
  type OutgoingMessage,
} from './types.js';

const PLATFORM = 'line' as const;

export interface LineWebhookEvent {
  type: string;
  timestamp: number;
  source: { type: 'user' | 'group' | 'room'; userId?: string; groupId?: string; roomId?: string };
  message?: { id: string; type: string; text?: string };
  replyToken?: string;
}

export interface LineTransport {
  start(handlers: { onEvent: (e: LineWebhookEvent) => void; onError: (err: unknown) => void }): Promise<void>;
  stop(): Promise<void>;
  reply(replyToken: string, text: string): Promise<void>;
  pushText(to: string, text: string): Promise<void>;
}

export interface LineBridgeOptions {
  readonly transport: LineTransport;
}

export class LineBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private readonly handlers: MessageHandler[] = [];
  private readonly errorHandlers: ErrorHandler[] = [];
  private lastReply = new Map<string, string>();

  constructor(private readonly opts: LineBridgeOptions) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.opts.transport.start({ onEvent: (e) => this.ingest(e), onError: (e) => this.emitError(e) });
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.opts.transport.stop().catch(() => undefined);
    this.connected = false;
  }
  isConnected(): boolean { return this.connected; }
  onMessage(h: MessageHandler): void { this.handlers.push(h); }
  onError(h: ErrorHandler): void { this.errorHandlers.push(h); }

  getCapabilities(): BridgeCapabilities {
    return { files: true, buttons: true, threads: false, slashCommands: false, maxMessageBytes: 5_000 };
  }

  async send(channelId: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    try {
      const token = this.lastReply.get(channelId);
      if (token) {
        this.lastReply.delete(channelId);
        await this.opts.transport.reply(token, content.text);
      } else {
        await this.opts.transport.pushText(channelId, content.text);
      }
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  private chatIdOf(e: LineWebhookEvent): string {
    if (e.source.type === 'group' && e.source.groupId) return e.source.groupId;
    if (e.source.type === 'room' && e.source.roomId) return e.source.roomId;
    return e.source.userId ?? 'unknown';
  }

  private ingest(raw: LineWebhookEvent): void {
    if (raw.type !== 'message' || raw.message?.type !== 'text') return;
    const chatId = this.chatIdOf(raw);
    if (raw.replyToken) this.lastReply.set(chatId, raw.replyToken);
    const incoming: IncomingMessage = {
      platform: PLATFORM,
      id: raw.message.id,
      channel: {
        id: chatId,
        ...(raw.source.type === 'user' ? { isDM: true } : {}),
      },
      user: { id: raw.source.userId ?? chatId, name: raw.source.userId ?? chatId },
      text: raw.message.text ?? '',
      timestamp: raw.timestamp,
    };
    for (const h of this.handlers) {
      try { void h(incoming); } catch (err) { this.emitError(err); }
    }
  }

  private emitError(err: unknown): void {
    for (const h of this.errorHandlers) { try { h(err); } catch { /* swallow */ } }
  }
}
