/**
 * Twitch IRC-chat bridge (production: tmi.js).
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

const PLATFORM = 'twitch' as const;

export interface TwitchRawMessage {
  channel: string;
  username: string;
  userId: string;
  text: string;
  id: string;
  timestamp: number;
  isMod?: boolean;
  isSubscriber?: boolean;
  isBroadcaster?: boolean;
}

export interface TwitchTransport {
  start(handlers: { onMessage: (m: TwitchRawMessage) => void; onError: (err: unknown) => void }): Promise<void>;
  stop(): Promise<void>;
  say(channel: string, text: string): Promise<void>;
}

export interface TwitchBridgeOptions {
  readonly transport: TwitchTransport;
  readonly botUsername?: string;
}

export class TwitchBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private readonly handlers: MessageHandler[] = [];
  private readonly errorHandlers: ErrorHandler[] = [];

  constructor(private readonly opts: TwitchBridgeOptions) {}

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
    return { files: false, buttons: false, threads: false, slashCommands: false, maxMessageBytes: 500 };
  }

  async send(channelId: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    try {
      const channel = channelId.startsWith('#') ? channelId : `#${channelId}`;
      await this.opts.transport.say(channel, content.text);
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  private ingest(raw: TwitchRawMessage): void {
    if (this.opts.botUsername && raw.username.toLowerCase() === this.opts.botUsername.toLowerCase()) return;
    const incoming: IncomingMessage = {
      platform: PLATFORM,
      id: raw.id,
      channel: { id: raw.channel, name: raw.channel.replace(/^#/, '') },
      user: { id: raw.userId, name: raw.username },
      text: raw.text,
      timestamp: raw.timestamp,
      platformData: {
        isMod: raw.isMod ?? false,
        isSubscriber: raw.isSubscriber ?? false,
        isBroadcaster: raw.isBroadcaster ?? false,
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
