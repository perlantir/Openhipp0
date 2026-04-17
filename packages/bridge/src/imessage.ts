/**
 * iMessage bridge — routes through a BlueBubbles-style HTTP relay.
 * Self-chat echo dedupe within a tunable window.
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

const PLATFORM = 'imessage' as const;

export interface IMessageRawPayload {
  guid: string;
  chatGuid: string;
  handleId: string;
  handleName?: string;
  text: string;
  timestamp: number;
  fromMe: boolean;
  subject?: string;
  groupTitle?: string;
}

export interface IMessageTransport {
  start(handlers: { onMessage: (msg: IMessageRawPayload) => void; onError: (err: unknown) => void }): Promise<void>;
  stop(): Promise<void>;
  sendText(chatGuid: string, text: string): Promise<void>;
}

export interface IMessageBridgeOptions {
  readonly transport: IMessageTransport;
  readonly dedupeWindowMs?: number;
  readonly dedupeBuffer?: number;
}

export class IMessageBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private readonly handlers: MessageHandler[] = [];
  private readonly errorHandlers: ErrorHandler[] = [];
  private readonly dedupeWindowMs: number;
  private readonly dedupeBuffer: number;
  private recentOut: Array<{ chatGuid: string; text: string; sentAt: number }> = [];

  constructor(private readonly opts: IMessageBridgeOptions) {
    this.dedupeWindowMs = opts.dedupeWindowMs ?? 2500;
    this.dedupeBuffer = opts.dedupeBuffer ?? 32;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.opts.transport.start({ onMessage: (m) => this.ingest(m), onError: (e) => this.emitError(e) });
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
    return { files: true, buttons: false, threads: false, slashCommands: false, maxMessageBytes: 20_000 };
  }

  async send(channelId: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    try {
      this.recentOut.push({ chatGuid: channelId, text: content.text, sentAt: Date.now() });
      while (this.recentOut.length > this.dedupeBuffer) this.recentOut.shift();
      await this.opts.transport.sendText(channelId, content.text);
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  private isSelfEcho(msg: IMessageRawPayload): boolean {
    if (!msg.fromMe) return false;
    const now = Date.now();
    return this.recentOut.some(
      (out) =>
        out.chatGuid === msg.chatGuid &&
        out.text === msg.text &&
        Math.abs(now - out.sentAt) <= this.dedupeWindowMs,
    );
  }

  private ingest(raw: IMessageRawPayload): void {
    if (this.isSelfEcho(raw)) return;
    const incoming: IncomingMessage = {
      platform: PLATFORM,
      id: raw.guid,
      channel: {
        id: raw.chatGuid,
        ...(raw.groupTitle ? { name: raw.groupTitle } : { isDM: true }),
      },
      user: { id: raw.handleId, name: raw.handleName ?? raw.handleId },
      text: raw.text,
      timestamp: raw.timestamp,
      ...(raw.subject ? { platformData: { subject: raw.subject } } : {}),
    };
    for (const h of this.handlers) {
      try { void h(incoming); } catch (err) { this.emitError(err); }
    }
  }

  private emitError(err: unknown): void {
    for (const h of this.errorHandlers) { try { h(err); } catch { /* swallow */ } }
  }
}
