/**
 * WhatsApp Business API bridge — Meta Cloud API.
 *
 * Meta delivers inbound via webhook (POST to /webhook). Outbound is a
 * REST POST to graph.facebook.com. This is the OFFICIAL bridge; the
 * existing whatsapp-web.js bridge stays as the unofficial option.
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

const PLATFORM = 'whatsapp-business' as const;

export interface WhatsAppBusinessIncoming {
  messageId: string;
  from: string; // sender's phone
  timestamp: number;
  text?: string;
  /** Media messages carry { id, mime_type, sha256 } instead of text. */
  media?: { id: string; mimeType: string; filename?: string };
  interactive?: { button_reply?: { id: string; title: string } };
}

export interface WhatsAppBusinessTransport {
  sendText(to: string, body: string): Promise<void>;
  sendInteractive?(
    to: string,
    body: string,
    buttons: Array<{ id: string; title: string }>,
  ): Promise<void>;
  fetchMedia(mediaId: string): Promise<{ url: string; mimeType: string } | null>;
}

export interface WhatsAppBusinessBridgeOptions {
  adminPhones?: readonly string[];
  transport: WhatsAppBusinessTransport;
}

export class WhatsAppBusinessBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private admins: Set<string>;

  constructor(private readonly opts: WhatsAppBusinessBridgeOptions) {
    this.admins = new Set(opts.adminPhones ?? []);
  }

  async connect(): Promise<void> {
    this.connected = true;
  }
  async disconnect(): Promise<void> {
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
    try {
      if (
        content.buttons &&
        content.buttons.length > 0 &&
        this.opts.transport.sendInteractive
      ) {
        await this.opts.transport.sendInteractive(
          to,
          content.text,
          content.buttons
            .slice(0, 3) // Meta cap
            .map((b) => ({ id: b.value, title: b.label })),
        );
      } else {
        await this.opts.transport.sendText(to, content.text);
      }
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  getCapabilities(): BridgeCapabilities {
    return { files: true, buttons: true, threads: false, slashCommands: false, maxMessageBytes: 4_096 };
  }

  /** Called by the webhook handler for each inbound message. */
  async ingest(raw: WhatsAppBusinessIncoming): Promise<void> {
    let text = raw.text ?? '';
    const attachments: Array<{ filename: string; contentType?: string; url: string }> = [];
    if (raw.media) {
      const resolved = await this.opts.transport.fetchMedia(raw.media.id).catch(() => null);
      if (resolved) {
        attachments.push({
          filename: raw.media.filename ?? `media-${raw.media.id}`,
          contentType: resolved.mimeType,
          url: resolved.url,
        });
      }
    }
    if (raw.interactive?.button_reply) {
      text = raw.interactive.button_reply.id;
    }
    const msg: IncomingMessage = {
      platform: PLATFORM,
      id: raw.messageId,
      channel: { id: raw.from, isDM: true },
      user: {
        id: raw.from,
        name: raw.from,
        isAdmin: this.admins.has(raw.from),
      },
      text,
      timestamp: raw.timestamp * 1000 || Date.now(),
      ...(attachments.length > 0 && { attachments }),
      ...(raw.interactive?.button_reply && {
        platformData: { frameType: 'button_reply' },
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
