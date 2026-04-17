/**
 * Zulip bridge — long-poll receive, REST send. Threaded by topic.
 *
 * Outgoing routing: callers set `platformData.zulipKind='stream'|'private'`.
 * For streams, `platformData.stream` + `platformData.topic` override defaults.
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

const PLATFORM = 'zulip' as const;

export interface ZulipRawMessage {
  id: number;
  sender_id: number;
  sender_email: string;
  sender_full_name: string;
  type: 'stream' | 'private';
  stream_id?: number;
  subject?: string;
  display_recipient?: string | Array<{ id: number; email: string }>;
  content: string;
  timestamp: number;
}

export interface ZulipTransport {
  start(handlers: { onMessage: (m: ZulipRawMessage) => void; onError: (err: unknown) => void }): Promise<void>;
  stop(): Promise<void>;
  sendStreamMessage(stream: string, topic: string, content: string): Promise<void>;
  sendPrivateMessage(userEmail: string, content: string): Promise<void>;
}

export interface ZulipBridgeOptions {
  readonly transport: ZulipTransport;
  readonly botEmail?: string;
}

export class ZulipBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private readonly handlers: MessageHandler[] = [];
  private readonly errorHandlers: ErrorHandler[] = [];

  constructor(private readonly opts: ZulipBridgeOptions) {}

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
    return { files: true, buttons: false, threads: true, slashCommands: false, maxMessageBytes: 10_000 };
  }

  async send(channelId: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    try {
      const pd = content.platformData as Record<string, unknown> | undefined;
      const kind = pd && typeof pd['zulipKind'] === 'string' ? (pd['zulipKind'] as string) : 'stream';
      if (kind === 'private') {
        const email = pd && typeof pd['email'] === 'string' ? (pd['email'] as string) : channelId;
        await this.opts.transport.sendPrivateMessage(email, content.text);
      } else {
        const stream = pd && typeof pd['stream'] === 'string' ? (pd['stream'] as string) : channelId;
        const topic = pd && typeof pd['topic'] === 'string' ? (pd['topic'] as string) : 'general';
        await this.opts.transport.sendStreamMessage(stream, topic, content.text);
      }
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  private ingest(raw: ZulipRawMessage): void {
    if (this.opts.botEmail && raw.sender_email === this.opts.botEmail) return;
    const isStream = raw.type === 'stream';
    const channelId =
      isStream && typeof raw.display_recipient === 'string'
        ? raw.display_recipient
        : !isStream && Array.isArray(raw.display_recipient)
          ? raw.display_recipient.map((r) => r.email).join(',')
          : raw.sender_email;
    const incoming: IncomingMessage = {
      platform: PLATFORM,
      id: String(raw.id),
      channel: {
        id: channelId,
        ...(isStream ? {} : { isDM: true }),
        ...(raw.subject ? { threadId: raw.subject } : {}),
      },
      user: { id: String(raw.sender_id), name: raw.sender_full_name },
      text: raw.content,
      timestamp: raw.timestamp * 1000,
      platformData: {
        ...(raw.subject ? { topic: raw.subject } : {}),
        zulipKind: isStream ? 'stream' : 'private',
      },
    };
    for (const h of this.handlers) {
      try { void h(incoming); } catch (err) { this.emitError(err); }
    }
  }

  private emitError(err: unknown): void {
    for (const h of this.errorHandlers) { try { h(err); } catch { /* swallow */ } }
  }
}
