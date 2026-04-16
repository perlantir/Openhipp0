/**
 * `hipp0 serve` — start the production HTTP server on :3100.
 *
 * This is the minimal entrypoint Docker / systemd / Railway invoke. It
 * exposes GET /health so deployment platforms can health-check the process;
 * the full REST + WebSocket surface is layered on top when the host wires
 * bridges in (Phase 9+ handle the full integrated serve path).
 */

import { Hipp0HttpServer, WebBridge, type IncomingMessage, type OutgoingMessage } from '@openhipp0/bridge';
import type { CommandResult } from '../types.js';

export interface ServeOptions {
  port?: number;
  host?: string;
  /** When true, start() returns immediately after binding (tests). */
  once?: boolean;
  /** Attach a WebBridge on /ws. Defaults to HIPP0_WITH_WS env var (1/true). */
  withWs?: boolean;
  /** Handler for inbound chat frames; defaults to an echo responder. */
  onMessage?: (msg: IncomingMessage) => Promise<OutgoingMessage | undefined> | OutgoingMessage | undefined;
}

export async function runServe(opts: ServeOptions = {}): Promise<CommandResult> {
  const port = opts.port ?? Number(process.env['HIPP0_PORT'] ?? 3100);
  const host = opts.host ?? process.env['HIPP0_HOST'] ?? '0.0.0.0';

  const server = new Hipp0HttpServer({
    port,
    host,
    healthProbe: () => ({
      status: 'ok',
      checks: [],
      uptime: process.uptime(),
      version: process.env['npm_package_version'] ?? '0.0.0',
    }),
  });

  const addr = await server.start();
  const banner = `🦛 hipp0 listening on http://${addr.host}:${addr.port}`;

  const enableWs = opts.withWs ?? envFlag(process.env['HIPP0_WITH_WS']);
  let webBridge: WebBridge | undefined;
  if (enableWs) {
    const http = server.getHttpServer();
    if (http) {
      webBridge = new WebBridge({ httpServer: http, path: '/ws', attachOnly: true });
      const handler = opts.onMessage ?? echoResponder;
      webBridge.onMessage(async (msg) => {
        const reply = await handler(msg);
        if (reply) await webBridge!.send(msg.channel.id, reply);
      });
      await webBridge.connect();
    }
  }

  if (opts.once) {
    if (webBridge) await webBridge.disconnect();
    await server.stop();
    return { exitCode: 0, stdout: [banner, 'stopped (--once)'], data: addr };
  }

  // Keep the process alive; SIGINT / SIGTERM trigger a graceful stop.
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      const stopper = webBridge ? webBridge.disconnect().catch(() => undefined) : Promise.resolve();
      stopper.then(() => server.stop()).finally(resolve);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
  return { exitCode: 0, stdout: [banner, 'stopped'] };
}

function envFlag(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function echoResponder(msg: IncomingMessage): OutgoingMessage {
  return {
    text: msg.text
      ? `(echo) ${msg.text}`
      : '🦛 Open Hipp0 received your message — wire up a Gateway in production to route through AgentRuntime.',
  };
}
