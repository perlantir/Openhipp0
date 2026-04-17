/**
 * Microsoft Teams bridge via Bot Framework Activities API.
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

const PLATFORM = 'teams' as const;

export interface TeamsActivity {
  id: string;
  type: string;
  conversation: { id: string; conversationType?: 'personal' | 'channel' };
  from: { id: string; name?: string };
  text: string;
  timestamp?: string;
  channelData?: { tenant?: { id: string }; team?: { id: string } };
}

export interface TeamsTransport {
  start(handlers: { onActivity: (a: TeamsActivity) => void; onError: (err: unknown) => void }): Promise<void>;
  stop(): Promise<void>;
  sendActivity(conversationId: string, body: { text: string }): Promise<void>;
}

export interface TeamsBridgeOptions {
  readonly transport: TeamsTransport;
  readonly botId?: string;
}

export class TeamsBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private readonly handlers: MessageHandler[] = [];
  private readonly errorHandlers: ErrorHandler[] = [];

  constructor(private readonly opts: TeamsBridgeOptions) {}

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.opts.transport.start({ onActivity: (a) => this.ingest(a), onError: (e) => this.emitError(e) });
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
    return { files: true, buttons: true, threads: true, slashCommands: false, maxMessageBytes: 28_000 };
  }

  async send(channelId: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    try {
      await this.opts.transport.sendActivity(channelId, { text: content.text });
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  private ingest(raw: TeamsActivity): void {
    if (raw.type !== 'message') return;
    if (this.opts.botId && raw.from.id === this.opts.botId) return;
    const incoming: IncomingMessage = {
      platform: PLATFORM,
      id: raw.id,
      channel: {
        id: raw.conversation.id,
        ...(raw.conversation.conversationType === 'personal' ? { isDM: true } : {}),
      },
      user: { id: raw.from.id, name: raw.from.name ?? raw.from.id },
      text: raw.text,
      timestamp: raw.timestamp ? Date.parse(raw.timestamp) : Date.now(),
      platformData: {
        tenantId: raw.channelData?.tenant?.id,
        teamId: raw.channelData?.team?.id,
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
