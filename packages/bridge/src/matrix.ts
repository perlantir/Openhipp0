/**
 * Matrix bridge — talks to a homeserver via matrix-js-sdk (production) or
 * a stub transport (tests). Room + DM distinction passes through unchanged;
 * thread + reaction support can be layered on the transport as those
 * features mature in matrix-js-sdk.
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

const PLATFORM = 'matrix' as const;

export interface MatrixRawEvent {
  roomId: string;
  eventId: string;
  sender: string;
  senderName?: string;
  body: string;
  timestamp: number;
  /** Room name if not a DM. */
  roomName?: string;
  isDm?: boolean;
  /** Parent event id for threaded replies. */
  relatesTo?: string;
}

export interface MatrixTransport {
  start(handlers: {
    onEvent: (ev: MatrixRawEvent) => void;
    onError: (err: unknown) => void;
  }): Promise<void>;
  stop(): Promise<void>;
  sendRoomMessage(roomId: string, body: string, opts?: { threadId?: string }): Promise<void>;
}

export interface MatrixBridgeOptions {
  userId?: string;
  adminUserIds?: readonly string[];
  transport: MatrixTransport;
}

export class MatrixBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private admins: Set<string>;

  constructor(private readonly opts: MatrixBridgeOptions) {
    this.admins = new Set(opts.adminUserIds ?? []);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.opts.transport.start({
      onEvent: (ev) => this.ingest(ev),
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

  async send(roomId: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    try {
      await this.opts.transport.sendRoomMessage(roomId, content.text, {
        ...(content.threadId !== undefined && { threadId: content.threadId }),
      });
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  getCapabilities(): BridgeCapabilities {
    return { files: true, buttons: false, threads: true, slashCommands: false, maxMessageBytes: 65_535 };
  }

  private ingest(ev: MatrixRawEvent): void {
    // Ignore our own messages.
    if (this.opts.userId && ev.sender === this.opts.userId) return;
    const msg: IncomingMessage = {
      platform: PLATFORM,
      id: ev.eventId,
      channel: {
        id: ev.roomId,
        ...(ev.roomName !== undefined && { name: ev.roomName }),
        ...(ev.isDm && { isDM: true }),
        ...(ev.relatesTo !== undefined && { threadId: ev.relatesTo }),
      },
      user: {
        id: ev.sender,
        name: ev.senderName ?? ev.sender,
        isAdmin: this.admins.has(ev.sender),
      },
      text: ev.body,
      timestamp: ev.timestamp,
      ...(ev.relatesTo !== undefined && { replyTo: ev.relatesTo }),
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
