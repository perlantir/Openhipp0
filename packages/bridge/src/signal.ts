/**
 * Signal bridge — talks to `signal-cli` (bundled with signal-cli-rest-api
 * or run locally). We keep the SDK pluggable: production callers pass a
 * transport adapter over signal-cli's JSON-RPC / REST endpoint, tests pass
 * a stub. The bridge itself only knows about the adapter's surface.
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

const PLATFORM = 'signal' as const;

export interface SignalRawMessage {
  source: string;
  sourceName?: string;
  timestamp: number;
  message: string;
  groupId?: string;
  attachments?: Array<{ filename: string; contentType?: string; size?: number; url: string }>;
}

export interface SignalTransport {
  /** Connect + start receiving. The transport calls `onMessage` for each
   *  inbound payload; subsequent reconnects are handled internally or by the
   *  bridge's ReconnectSupervisor. */
  start(handlers: {
    onMessage: (msg: SignalRawMessage) => void;
    onError: (err: unknown) => void;
  }): Promise<void>;
  stop(): Promise<void>;
  send(recipient: string, content: { text: string; attachments?: readonly Buffer[] }): Promise<void>;
}

export interface SignalBridgeOptions {
  /** Phone number registered with signal-cli (E.164). */
  number?: string;
  adminUserIds?: readonly string[];
  transport: SignalTransport;
}

export class SignalBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private admins: Set<string>;

  constructor(private readonly opts: SignalBridgeOptions) {
    this.admins = new Set(opts.adminUserIds ?? []);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.opts.transport.start({
      onMessage: (raw) => this.ingest(raw),
      onError: (err) => this.emitError(err),
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

  async send(recipient: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    try {
      const attachments = (content.attachments ?? [])
        .map((a) => {
          if (Buffer.isBuffer(a.content)) return a.content;
          if (typeof a.content === 'string') return Buffer.from(a.content);
          return null;
        })
        .filter((b): b is Buffer => b !== null);
      await this.opts.transport.send(recipient, {
        text: content.text,
        ...(attachments.length > 0 && { attachments }),
      });
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  getCapabilities(): BridgeCapabilities {
    return { files: true, buttons: false, threads: false, slashCommands: false, maxMessageBytes: 4096 };
  }

  // ───────────────────────────────────────────────────────────────────────

  private ingest(raw: SignalRawMessage): void {
    const channelId = raw.groupId ?? raw.source;
    const msg: IncomingMessage = {
      platform: PLATFORM,
      id: `${raw.source}:${raw.timestamp}`,
      channel: { id: channelId, ...(raw.groupId && { name: raw.groupId }) },
      user: {
        id: raw.source,
        name: raw.sourceName ?? raw.source,
        isAdmin: this.admins.has(raw.source),
      },
      text: raw.message,
      timestamp: raw.timestamp,
      ...(raw.attachments &&
        raw.attachments.length > 0 && {
          attachments: raw.attachments.map((a) => ({
            filename: a.filename,
            ...(a.contentType !== undefined && { contentType: a.contentType }),
            ...(a.size !== undefined && { size: a.size }),
            url: a.url,
          })),
        }),
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
