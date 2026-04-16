/**
 * SMS bridge — Twilio webhook inbound, Twilio REST outbound.
 *
 * Twilio's webhook posts an SMS/MMS payload. The bridge accepts arrivals
 * via `ingest()` (called by the Twilio webhook handler) and sends via the
 * injected transport. Phone numbers are normalized to E.164.
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

const PLATFORM = 'sms' as const;

export interface SmsIncomingPayload {
  MessageSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
  /** Present when NumMedia > 0; indexed MediaUrl0, MediaUrl1… */
  [key: string]: string | undefined;
}

export interface SmsTransport {
  send(to: string, from: string, body: string, media?: readonly string[]): Promise<void>;
}

export interface SmsBridgeOptions {
  /** Our own Twilio number (E.164). */
  from: string;
  adminNumbers?: readonly string[];
  transport: SmsTransport;
}

export class SmsBridge implements MessageBridge {
  readonly platform = PLATFORM;
  private connected = false;
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private admins: Set<string>;

  constructor(private readonly opts: SmsBridgeOptions) {
    this.admins = new Set(opts.adminNumbers ?? []);
  }

  async connect(): Promise<void> {
    // Webhook-driven; no long-lived connection to open. We flip the flag so
    // send() can execute.
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

  async send(recipient: string, content: OutgoingMessage): Promise<void> {
    if (!this.connected) throw new Hipp0BridgeNotConnectedError(PLATFORM);
    try {
      const media = (content.attachments ?? [])
        .map((a) => a.url)
        .filter((u): u is string => typeof u === 'string' && u.length > 0);
      await this.opts.transport.send(
        recipient,
        this.opts.from,
        content.text,
        media.length > 0 ? media : undefined,
      );
    } catch (err) {
      throw new Hipp0BridgeSendError(PLATFORM, err);
    }
  }

  getCapabilities(): BridgeCapabilities {
    return { files: true, buttons: false, threads: false, slashCommands: false, maxMessageBytes: 1600 };
  }

  /** Called by the Twilio webhook handler for each inbound message. */
  ingest(payload: SmsIncomingPayload): void {
    const numMedia = Number(payload.NumMedia ?? '0');
    const attachments = [];
    for (let i = 0; i < numMedia; i++) {
      const url = payload[`MediaUrl${i}`];
      const ct = payload[`MediaContentType${i}`];
      if (url) {
        attachments.push({
          filename: `mms-${i}`,
          ...(ct !== undefined && { contentType: ct }),
          url,
        });
      }
    }
    const msg: IncomingMessage = {
      platform: PLATFORM,
      id: payload.MessageSid,
      channel: { id: payload.From, isDM: true },
      user: {
        id: payload.From,
        name: payload.From,
        isAdmin: this.admins.has(payload.From),
      },
      text: payload.Body,
      timestamp: Date.now(),
      ...(attachments.length > 0 && { attachments }),
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
