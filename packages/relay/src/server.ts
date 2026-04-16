/**
 * Open Hipp0 Relay — stateless WebSocket router.
 *
 * Clients connect with ?clientId=…&token=…, register their identity, then
 * post `{type:'envelope', to, from, payload}` frames. The relay forwards
 * the frame verbatim to the addressed client if it's currently connected;
 * buffers briefly (up to 60 s, RAM-only) if not, then drops. It never
 * inspects `payload` — that's an opaque NaCl-box ciphertext.
 */

import { EventEmitter } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import { verifyClient, type CredentialStore } from './auth.js';

const EnvelopeFrameSchema = z.object({
  type: z.literal('envelope'),
  /** Recipient clientId. */
  to: z.string().min(1),
  /** Sender clientId — cross-checked with the authenticated id. */
  from: z.string().min(1),
  /** Base64 or hex-encoded NaCl-box envelope. Relay never decodes. */
  payload: z.string().min(1),
  /** Client-generated id — used for delivery receipts. */
  msgId: z.string().min(1).max(64),
});

const ClientFrameSchema = z.discriminatedUnion('type', [
  EnvelopeFrameSchema,
  z.object({ type: z.literal('ping') }),
]);

type ClientFrame = z.infer<typeof ClientFrameSchema>;

export interface RelayOptions {
  port: number;
  host?: string;
  credentials: CredentialStore;
  /** RAM-only buffer per offline recipient. Oldest-first drop on overflow. */
  bufferPerClient?: number;
  /** Buffer retention in ms before the relay drops the pending envelope. */
  bufferTtlMs?: number;
}

interface Connection {
  clientId: string;
  ws: WebSocket;
  connectedAt: number;
}

interface BufferedEnvelope {
  from: string;
  payload: string;
  msgId: string;
  queuedAt: number;
}

export class RelayServer extends EventEmitter {
  private readonly options: Required<Omit<RelayOptions, 'host'>> & { host: string };
  private readonly connections = new Map<string, Connection>();
  private readonly pending = new Map<string, BufferedEnvelope[]>();
  private wss: WebSocketServer | undefined;
  private sweepTimer: NodeJS.Timeout | undefined;

  constructor(options: RelayOptions) {
    super();
    this.options = {
      port: options.port,
      host: options.host ?? '0.0.0.0',
      credentials: options.credentials,
      bufferPerClient: options.bufferPerClient ?? 32,
      bufferTtlMs: options.bufferTtlMs ?? 60_000,
    };
  }

  async listen(): Promise<void> {
    this.wss = new WebSocketServer({ host: this.options.host, port: this.options.port });
    this.wss.on('connection', (ws, req) => void this.handleConnection(ws, req.url ?? ''));
    this.sweepTimer = setInterval(() => this.sweepPending(), 10_000);
    this.sweepTimer.unref?.();
    await new Promise<void>((resolve) => this.wss?.once('listening', () => resolve()));
  }

  async close(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    for (const conn of this.connections.values()) conn.ws.close();
    this.connections.clear();
    await new Promise<void>((resolve) => this.wss?.close(() => resolve()));
  }

  /** Count of currently-authenticated connections. */
  connectionCount(): number {
    return this.connections.size;
  }

  private async handleConnection(ws: WebSocket, url: string): Promise<void> {
    const query = new URL(`ws://stub${url}`).searchParams;
    const clientId = query.get('clientId');
    const token = query.get('token');
    if (!clientId || !token) {
      ws.close(1008, 'missing clientId/token');
      return;
    }
    const ok = await verifyClient(clientId, token, this.options.credentials);
    if (!ok) {
      ws.close(1008, 'unauthorized');
      return;
    }
    // Replace any previous connection for this clientId (single session).
    const previous = this.connections.get(clientId);
    if (previous) previous.ws.close(1000, 'replaced');

    const conn: Connection = { clientId, ws, connectedAt: Date.now() };
    this.connections.set(clientId, conn);
    this.emit('client:connect', { clientId });
    ws.send(JSON.stringify({ type: 'hello', clientId }));

    ws.on('message', (raw) => {
      let frame: ClientFrame;
      try {
        const parsed = JSON.parse(raw.toString()) as unknown;
        frame = ClientFrameSchema.parse(parsed);
      } catch {
        ws.send(JSON.stringify({ type: 'error', code: 'bad-frame' }));
        return;
      }
      if (frame.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (frame.from !== clientId) {
        ws.send(JSON.stringify({ type: 'error', code: 'sender-mismatch' }));
        return;
      }
      this.route(frame);
    });

    ws.on('close', () => {
      if (this.connections.get(clientId) === conn) {
        this.connections.delete(clientId);
        this.emit('client:disconnect', { clientId });
      }
    });

    ws.on('error', (err) => this.emit('error', { clientId, err }));

    // Flush any buffered envelopes addressed to this client
    const queued = this.pending.get(clientId);
    if (queued && queued.length > 0) {
      for (const env of queued) {
        ws.send(
          JSON.stringify({
            type: 'envelope',
            to: clientId,
            from: env.from,
            payload: env.payload,
            msgId: env.msgId,
            queuedAt: env.queuedAt,
          }),
        );
      }
      this.pending.delete(clientId);
    }
  }

  private route(frame: z.infer<typeof EnvelopeFrameSchema>): void {
    const recipient = this.connections.get(frame.to);
    if (recipient) {
      recipient.ws.send(JSON.stringify(frame));
      this.emit('envelope:delivered', { from: frame.from, to: frame.to, msgId: frame.msgId });
      return;
    }
    // Recipient offline — buffer briefly
    let queue = this.pending.get(frame.to);
    if (!queue) {
      queue = [];
      this.pending.set(frame.to, queue);
    }
    queue.push({ from: frame.from, payload: frame.payload, msgId: frame.msgId, queuedAt: Date.now() });
    while (queue.length > this.options.bufferPerClient) queue.shift();
    this.emit('envelope:buffered', { from: frame.from, to: frame.to, msgId: frame.msgId });
  }

  private sweepPending(): void {
    const now = Date.now();
    for (const [clientId, queue] of this.pending) {
      const kept = queue.filter((env) => now - env.queuedAt < this.options.bufferTtlMs);
      if (kept.length === 0) this.pending.delete(clientId);
      else this.pending.set(clientId, kept);
    }
  }
}
