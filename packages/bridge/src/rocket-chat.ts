/**
 * Rocket.Chat bridge — Realtime WS receive, REST send. Threaded via
 * `tmid`.
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

const PLATFORM = 'rocket-chat' as const;

export interface RocketChatRawMessage {
  _id: string;
  rid: string;
  msg: string;
  u: { _id: string; username: string };
  ts: { $date: number } | number;
  t?: string;
  bot?: { i: string };
}

export interface RocketChatTransport {
  start(handlers: { onMessage: (m: RocketChatRawMessage) => void; onError: (err: unknown) => void }): Promise<void>;
  stop(): Promise<void>;
  postMessage(roomId: string, text: string, opts?: { tmid?: string }): Promise<void>;
}

export interface RocketChatBridgeOptions {
  readonly transport: RocketChatTransport;
  readonly botUserId?: string;
}

function toEpochMs(ts: RocketChatRawMessage['ts']): number {
  return typeof ts === 'number' ? ts : ts.$date;
}

export class RocketChatBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private readonly handlers: MessageHandler[] = [];
  private readonly errorHandlers: ErrorHandler[] = [];

  constructor(private readonly opts: RocketChatBridgeOptions) {}

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
    return { files: true, buttons: true, threads: true, slashCommands: true, maxMessageBytes: 5_000 };
  }

  async send(channelId: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    try {
      const opts = content.threadId ? { tmid: content.threadId } : undefined;
      await this.opts.transport.postMessage(channelId, content.text, opts);
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  private ingest(raw: RocketChatRawMessage): void {
    if (raw.t) return;
    if (raw.bot) return;
    if (this.opts.botUserId && raw.u._id === this.opts.botUserId) return;
    const incoming: IncomingMessage = {
      platform: PLATFORM,
      id: raw._id,
      channel: { id: raw.rid },
      user: { id: raw.u._id, name: raw.u.username },
      text: raw.msg,
      timestamp: toEpochMs(raw.ts),
    };
    for (const h of this.handlers) {
      try { void h(incoming); } catch (err) { this.emitError(err); }
    }
  }

  private emitError(err: unknown): void {
    for (const h of this.errorHandlers) { try { h(err); } catch { /* swallow */ } }
  }
}
