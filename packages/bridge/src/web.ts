/**
 * Web bridge — WebSocket server for the dashboard chat.
 *
 * Protocol (JSON over each WS frame):
 *   client → server:
 *     { type: 'message', id, user: {id, name}, text, replyTo?, platformData? }
 *     { type: 'button', parentId, buttonValue }
 *   server → client:
 *     { type: 'response', text, buttons?, attachments?, replyTo? }
 *     { type: 'status', status: 'connected' | 'typing' | 'error', message? }
 *
 * Each WS connection becomes a distinct `channel` keyed by the connection id
 * (cryptographic random). send() targets a specific channel; if that channel
 * has closed, send() throws Hipp0BridgeNotConnectedError.
 *
 * Auth: optional `authenticate(req)` callback resolves each upgrade. Returns
 * a BridgeUser on success, null on reject — the socket is closed immediately.
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage as HttpIncomingMessage } from 'node:http';
import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  Hipp0BridgeError,
  Hipp0BridgeNotConnectedError,
  Hipp0BridgeSendError,
  type BridgeCapabilities,
  type BridgeUser,
  type ErrorHandler,
  type IncomingMessage,
  type MessageBridge,
  type MessageHandler,
  type OutgoingMessage,
} from './types.js';

const WEB_PLATFORM = 'web' as const;
const DEFAULT_PORT = 3200;

export type WebAuthenticator = (
  req: HttpIncomingMessage,
) => Promise<BridgeUser | null> | BridgeUser | null;

export interface WebBridgeOptions {
  port?: number;
  host?: string;
  path?: string;
  /** Optional per-upgrade auth. Default: accept all with user id = 'web:<uuid>'. */
  authenticate?: WebAuthenticator;
  /** Inject a prebuilt HTTP server (e.g. one shared with a dashboard HTTP API). */
  httpServer?: HttpServer;
  /** If true, do NOT listen() — caller has already done so. Default false. */
  attachOnly?: boolean;
}

interface Channel {
  id: string;
  user: BridgeUser;
  socket: WebSocket;
}

export class WebBridge implements MessageBridge {
  readonly platform = WEB_PLATFORM;
  private wss: WebSocketServer | undefined;
  private httpServer: HttpServer | undefined;
  private channels = new Map<string, Channel>();
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  private connected = false;
  private readonly opts: Required<Omit<WebBridgeOptions, 'httpServer' | 'authenticate'>> & {
    httpServer?: HttpServer;
    authenticate?: WebAuthenticator;
  };

  constructor(opts: WebBridgeOptions = {}) {
    this.opts = {
      port: opts.port ?? DEFAULT_PORT,
      host: opts.host ?? '127.0.0.1',
      path: opts.path ?? '/ws',
      attachOnly: opts.attachOnly ?? false,
      ...(opts.httpServer && { httpServer: opts.httpServer }),
      ...(opts.authenticate && { authenticate: opts.authenticate }),
    };
  }

  async connect(): Promise<void> {
    if (this.connected) return;

    this.httpServer = this.opts.httpServer ?? createServer();
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: this.opts.path,
    });
    this.wss.on('connection', (socket, req) => {
      void this.handleConnection(socket, req);
    });
    this.wss.on('error', (err) => this.emitError(err));

    if (!this.opts.attachOnly && !this.opts.httpServer) {
      await new Promise<void>((resolve, reject) => {
        this.httpServer!.once('error', reject);
        this.httpServer!.listen(this.opts.port, this.opts.host, () => {
          this.httpServer!.off('error', reject);
          resolve();
        });
      });
    }
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    for (const ch of this.channels.values()) {
      try {
        ch.socket.close(1001, 'bridge disconnecting');
      } catch {
        /* ignore */
      }
    }
    this.channels.clear();
    await new Promise<void>((resolve) => {
      if (!this.wss) return resolve();
      this.wss.close(() => resolve());
    });
    if (this.httpServer && !this.opts.attachOnly && !this.opts.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
    }
    this.wss = undefined;
    this.httpServer = undefined;
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }

  onMessage(handler: MessageHandler): void {
    this.handlers.push(handler);
  }

  onError(handler: ErrorHandler): void {
    this.errorHandlers.push(handler);
  }

  async send(channelId: string, content: OutgoingMessage): Promise<void> {
    const ch = this.channels.get(channelId);
    if (!ch) throw new Hipp0BridgeNotConnectedError(WEB_PLATFORM);
    try {
      const frame: Record<string, unknown> = {
        type: 'response',
        text: content.text,
      };
      if (content.buttons) frame.buttons = content.buttons;
      if (content.attachments) {
        frame.attachments = content.attachments.map((a) => ({
          filename: a.filename,
          ...(a.url && { url: a.url }),
          ...(a.contentType && { contentType: a.contentType }),
        }));
      }
      if (content.replyTo) frame.replyTo = content.replyTo;
      ch.socket.send(JSON.stringify(frame));
    } catch (err) {
      throw new Hipp0BridgeSendError(WEB_PLATFORM, err);
    }
  }

  getCapabilities(): BridgeCapabilities {
    return {
      files: true,
      buttons: true,
      threads: false,
      slashCommands: false,
      maxMessageBytes: 1_000_000,
    };
  }

  /** Channel ids that are currently open. Exposed for tests / dashboard. */
  openChannels(): string[] {
    return [...this.channels.keys()];
  }

  // ─────────────────────────────────────────────────────────────────────────

  private async handleConnection(socket: WebSocket, req: HttpIncomingMessage): Promise<void> {
    let user: BridgeUser;
    try {
      if (this.opts.authenticate) {
        const u = await this.opts.authenticate(req);
        if (!u) {
          socket.close(4401, 'unauthorized');
          return;
        }
        user = u;
      } else {
        user = { id: `web:${randomUUID()}`, name: 'web-user' };
      }
    } catch (err) {
      this.emitError(err);
      socket.close(4500, 'auth error');
      return;
    }

    const channelId = `web:${randomUUID()}`;
    this.channels.set(channelId, { id: channelId, user, socket });

    socket.on('message', (data) => {
      let text: string;
      try {
        text = typeof data === 'string' ? data : data.toString('utf8');
      } catch {
        return;
      }
      this.handleFrame(channelId, user, text);
    });
    socket.on('close', () => {
      this.channels.delete(channelId);
    });
    socket.on('error', (err) => this.emitError(err));

    // Announce successful connect.
    try {
      socket.send(JSON.stringify({ type: 'status', status: 'connected', channelId }));
    } catch {
      /* ignore */
    }
  }

  private handleFrame(channelId: string, user: BridgeUser, raw: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch (err) {
      this.emitError(new Hipp0BridgeError('invalid JSON frame', WEB_PLATFORM));
      void err;
      return;
    }
    const type = parsed.type;
    if (type !== 'message' && type !== 'button') return;

    const text = type === 'button' ? String(parsed.buttonValue ?? '') : String(parsed.text ?? '');
    const id = String(parsed.id ?? randomUUID());
    const replyTo = typeof parsed.replyTo === 'string' ? parsed.replyTo : undefined;

    const msg: IncomingMessage = {
      platform: WEB_PLATFORM,
      id,
      channel: { id: channelId, name: 'web-session', isDM: true },
      user,
      text,
      timestamp: Date.now(),
      ...(replyTo && { replyTo }),
      platformData: { frameType: type, ...(parsed as Record<string, unknown>) },
    };
    for (const h of this.handlers) {
      try {
        const result = h(msg);
        if (result && typeof (result as Promise<void>).catch === 'function') {
          (result as Promise<void>).catch((err) => this.emitError(err));
        }
      } catch (err) {
        this.emitError(err);
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
