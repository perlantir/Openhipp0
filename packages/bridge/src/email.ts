/**
 * Email bridge — IMAP poll for inbound, SMTP for outbound.
 *
 * Production uses imapflow + nodemailer; tests inject a polling transport
 * that emits raw inbound emails and accepts outbound payloads.
 * Threads are represented by message-id / in-reply-to headers.
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

const PLATFORM = 'email' as const;

export interface EmailRawMessage {
  messageId: string;
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  textBody: string;
  date: Date;
  inReplyTo?: string;
  /** All message-ids this message references (chain). */
  references?: readonly string[];
  attachments?: Array<{ filename: string; contentType?: string; size?: number; url?: string }>;
}

export interface EmailOutbound {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: readonly string[];
}

export interface EmailTransport {
  start(handlers: {
    onMessage: (msg: EmailRawMessage) => void;
    onError: (err: unknown) => void;
  }): Promise<void>;
  stop(): Promise<void>;
  send(msg: EmailOutbound): Promise<void>;
}

export interface EmailBridgeOptions {
  /** Our own email — messages from this are dropped. */
  selfAddress?: string;
  adminAddresses?: readonly string[];
  transport: EmailTransport;
  /** Optional subject-line prefix on outbound replies. Default 'Re: '. */
  replyPrefix?: string;
}

export class EmailBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private admins: Set<string>;
  /** Remembers the subject used for a given thread so replies can mirror it. */
  private threadSubjects = new Map<string, string>();

  constructor(private readonly opts: EmailBridgeOptions) {
    this.admins = new Set((opts.adminAddresses ?? []).map((a) => a.toLowerCase()));
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.opts.transport.start({
      onMessage: (m) => this.ingest(m),
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

  async send(to: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    const prefix = this.opts.replyPrefix ?? 'Re: ';
    const prior = content.replyTo ? this.threadSubjects.get(content.replyTo) : undefined;
    const subject = prior ? `${prefix}${prior}` : 'Message from Open Hipp0';
    const msg: EmailOutbound = {
      to,
      subject,
      body: content.text,
    };
    if (content.replyTo !== undefined) msg.inReplyTo = content.replyTo;
    try {
      await this.opts.transport.send(msg);
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  getCapabilities(): BridgeCapabilities {
    return { files: true, buttons: false, threads: true, slashCommands: false, maxMessageBytes: 10_000_000 };
  }

  private ingest(raw: EmailRawMessage): void {
    if (this.opts.selfAddress && raw.from.toLowerCase() === this.opts.selfAddress.toLowerCase()) return;
    this.threadSubjects.set(raw.messageId, raw.subject);
    const lcFrom = raw.from.toLowerCase();
    const msg: IncomingMessage = {
      platform: PLATFORM,
      id: raw.messageId,
      channel: { id: lcFrom, isDM: true },
      user: {
        id: lcFrom,
        name: raw.fromName ?? lcFrom,
        isAdmin: this.admins.has(lcFrom),
      },
      text: raw.textBody,
      timestamp: raw.date.getTime(),
      ...(raw.inReplyTo !== undefined && { replyTo: raw.inReplyTo }),
      ...(raw.attachments &&
        raw.attachments.length > 0 && {
          attachments: raw.attachments.map((a) => ({
            filename: a.filename,
            ...(a.contentType !== undefined && { contentType: a.contentType }),
            ...(a.size !== undefined && { size: a.size }),
            url: a.url ?? '',
          })),
        }),
      platformData: {
        subject: raw.subject,
        ...(raw.references && { references: raw.references }),
      },
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
