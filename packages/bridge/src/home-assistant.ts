/**
 * Home Assistant bridge — WebSocket API.
 *
 * Primary use cases: (1) assist pipeline integrations — receive voice or
 * text commands that Home Assistant forwards as conversation events, and
 * (2) dispatch natural-language replies back to a TTS speaker or notify
 * service. State-change events are surfaced as platform-data events but
 * not passed through as IncomingMessages (they aren't user-intended).
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

const PLATFORM = 'home-assistant' as const;

export interface HaConversationEvent {
  conversationId: string;
  userId: string;
  userName?: string;
  text: string;
  timestamp: number;
}

export interface HaTransport {
  start(handlers: {
    onConversation: (ev: HaConversationEvent) => void;
    onError: (err: unknown) => void;
  }): Promise<void>;
  stop(): Promise<void>;
  /** Call a HA service (e.g. notify.mobile_app, tts.speak). */
  callService(
    domain: string,
    service: string,
    data: Record<string, unknown>,
  ): Promise<void>;
}

export interface HaBridgeOptions {
  /** Service target for outbound replies. Default: notify.notify. */
  notifyService?: { domain: string; service: string };
  adminUserIds?: readonly string[];
  transport: HaTransport;
}

export class HomeAssistantBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private admins: Set<string>;
  private notify: { domain: string; service: string };

  constructor(private readonly opts: HaBridgeOptions) {
    this.admins = new Set(opts.adminUserIds ?? []);
    this.notify = opts.notifyService ?? { domain: 'notify', service: 'notify' };
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.opts.transport.start({
      onConversation: (ev) => this.ingest(ev),
      onError: (e) => this.emitError(e),
    });
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.opts.transport.stop().catch(() => undefined);
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  onMessage(h: MessageHandler): void {
    this.handlers.push(h);
  }
  onError(h: ErrorHandler): void {
    this.errorHandlers.push(h);
  }

  async send(channelId: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    try {
      // channelId is a conversation-id or a comma-separated list of HA targets.
      const target = channelId === 'conversation' ? undefined : channelId;
      await this.opts.transport.callService(this.notify.domain, this.notify.service, {
        message: content.text,
        ...(target && { target }),
      });
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  /** Lower-level: fire a HA service call directly. Not a MessageBridge method. */
  async callService(domain: string, service: string, data: Record<string, unknown>): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    await this.opts.transport.callService(domain, service, data);
  }

  getCapabilities(): BridgeCapabilities {
    return { files: false, buttons: false, threads: false, slashCommands: true, maxMessageBytes: 4_096 };
  }

  private ingest(ev: HaConversationEvent): void {
    const msg: IncomingMessage = {
      platform: PLATFORM,
      id: `${ev.conversationId}:${ev.timestamp}`,
      channel: { id: ev.conversationId },
      user: {
        id: ev.userId,
        name: ev.userName ?? ev.userId,
        isAdmin: this.admins.has(ev.userId),
      },
      text: ev.text,
      timestamp: ev.timestamp,
    };
    this.dispatch(msg);
  }

  private dispatch(msg: IncomingMessage): void {
    for (const h of this.handlers) {
      try {
        const r = h(msg);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch((e) => this.emitError(e));
        }
      } catch (e) {
        this.emitError(e);
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
