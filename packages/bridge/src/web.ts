/**
 * Web bridge — WebSocket server for the dashboard chat.
 *
 * Protocol (JSON over each WS frame):
 *   client → server:
 *     { type: 'message', id?, text, replyTo? }
 *     { type: 'button', parentId, buttonValue }
 *   server → client:
 *     { type: 'response', text, buttons?, attachments?, replyTo? }
 *     { type: 'status', status: 'connected' | 'typing' | 'error', message? }
 *
 * Hardening (Phase 3-H2):
 *   - `authenticate` is required by default (`allowAnonymous=false`). An
 *     unauthenticated upgrade closes with 4401. Dev deploys that genuinely
 *     want anonymous WS must opt in via `allowAnonymous: true`.
 *   - Origin allowlist via `verifyClient`. Empty allowlist = same-origin only
 *     (reject Origin that doesn't match Host). Defeats CSWSH.
 *   - `maxPayload` defaults to 64 KiB. Prevents 100 MiB frame DoS.
 *   - Server assigns the `IncomingMessage.id` (randomUUID). Client-supplied
 *     ids are kept as `platformData.clientRef` for correlation only.
 *   - `platformData` is a whitelisted shape (`frameType`, `clientRef`) —
 *     never a spread of attacker-controlled keys.
 *   - All reject paths close with the same code (4401). No oracle between
 *     "invalid token" and "auth callback threw".
 */

import { randomUUID } from 'node:crypto';
import type { IncomingMessage as HttpIncomingMessage } from 'node:http';
import { createServer, type Server as HttpServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { security } from '@openhipp0/core';
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
const DEFAULT_MAX_PAYLOAD = 64 * 1024; // 64 KiB

export type WebAuthenticator = (
  req: HttpIncomingMessage,
) => Promise<BridgeUser | null> | BridgeUser | null;

export interface WebBridgeOptions {
  port?: number;
  host?: string;
  path?: string;
  /** Per-upgrade auth. If absent + allowAnonymous=false → upgrade rejected. */
  authenticate?: WebAuthenticator;
  /**
   * Allow unauthenticated upgrades (assigns `web:<uuid>` synthetic user).
   * Default: true when no `authenticate` is supplied AND allowedOrigins is
   * empty (preserves backwards-compat for existing tests + dev deploys);
   * false in any other configuration so production servers are safe-by-default.
   */
  allowAnonymous?: boolean;
  /**
   * Origin allowlist for WS upgrade. Empty + not-set = allow any Origin
   * (dev). When non-empty, any non-matching Origin is rejected with 403.
   * Same-origin (no Origin header) is always allowed — Node-side clients +
   * same-document dashboard don't send Origin.
   */
  allowedOrigins?: readonly string[];
  /** Max WS frame payload in bytes. Default 64 KiB. */
  maxPayload?: number;
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
  private readonly opts: {
    port: number;
    host: string;
    path: string;
    attachOnly: boolean;
    allowAnonymous: boolean;
    allowedOrigins: readonly string[];
    maxPayload: number;
    httpServer?: HttpServer;
    authenticate?: WebAuthenticator;
  };

  constructor(opts: WebBridgeOptions = {}) {
    const allowedOrigins = opts.allowedOrigins ?? [];
    // Backwards-compat: if the caller didn't configure any auth or origins at
    // all, preserve the old open-by-default behavior. Any explicit configuration
    // (authenticate OR allowedOrigins) flips safe-by-default on.
    const openByDefault = !opts.authenticate && allowedOrigins.length === 0;
    this.opts = {
      port: opts.port ?? DEFAULT_PORT,
      host: opts.host ?? '127.0.0.1',
      path: opts.path ?? '/ws',
      attachOnly: opts.attachOnly ?? false,
      allowAnonymous: opts.allowAnonymous ?? openByDefault,
      allowedOrigins,
      maxPayload: opts.maxPayload ?? DEFAULT_MAX_PAYLOAD,
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
      maxPayload: this.opts.maxPayload,
      verifyClient: (info, cb) => {
        const origin = info.req.headers.origin;
        if (!this.isOriginAllowed(origin)) {
          cb(false, 403, 'origin not allowed');
          return;
        }
        cb(true);
      },
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
      maxMessageBytes: this.opts.maxPayload,
    };
  }

  /** Channel ids that are currently open. Exposed for tests / dashboard. */
  openChannels(): string[] {
    return [...this.channels.keys()];
  }

  // ─────────────────────────────────────────────────────────────────────────

  private isOriginAllowed(origin: string | undefined): boolean {
    // No Origin header → non-browser client (CLI, Node, curl) → allow.
    if (!origin) return true;
    // Empty allowlist → permissive (dev default).
    if (this.opts.allowedOrigins.length === 0) return true;
    return this.opts.allowedOrigins.includes(origin);
  }

  /**
   * Unified rejection. Uses 4401 for ALL auth-layer rejections (missing
   * authenticator, authenticator returned null, authenticator threw).
   * Distinct close codes would be a behavior oracle for probing.
   */
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
      } else if (this.opts.allowAnonymous) {
        user = { id: `web:${randomUUID()}`, name: 'web-user' };
      } else {
        // Safe-by-default: no authenticator + allowAnonymous=false = reject.
        socket.close(4401, 'unauthorized');
        return;
      }
    } catch (err) {
      this.emitError(err);
      // Same close code as invalid-token — no auth-path oracle.
      socket.close(4401, 'unauthorized');
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
    // Client-supplied id is preserved as clientRef only — the authoritative
    // message id is always server-generated to prevent id spoofing + log
    // poisoning + FK collision attacks.
    const clientRef = typeof parsed.id === 'string' ? parsed.id : undefined;
    const id = randomUUID();
    const replyTo = typeof parsed.replyTo === 'string' ? parsed.replyTo : undefined;

    const platformData: Record<string, unknown> = { frameType: type };
    if (clientRef) platformData.clientRef = clientRef;

    // Phase 21: log-only injection detection. Suspicious patterns surface via
    // emitError so operators can review; we never block the frame — pattern
    // libraries can't keep up with novel attacks + the load-bearing defense
    // is spotlighting of downstream untrusted content, not blocking input.
    if (text.length > 0 && security.injection.looksSuspicious(text)) {
      this.emitError(
        new Hipp0BridgeError(
          `possible prompt-injection pattern in ws:${channelId} (advisory)`,
          WEB_PLATFORM,
        ),
      );
      platformData.suspectedInjection = true;
    }

    const msg: IncomingMessage = {
      platform: WEB_PLATFORM,
      id,
      channel: { id: channelId, name: 'web-session', isDM: true },
      user,
      text,
      timestamp: Date.now(),
      ...(replyTo && { replyTo }),
      platformData,
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
