/**
 * `hipp0 serve` — start the production HTTP server on :3100.
 *
 * This is the minimal entrypoint Docker / systemd / Railway invoke. It
 * exposes GET /health so deployment platforms can health-check the process;
 * the full REST + WebSocket surface is layered on top when the host wires
 * bridges in (Phase 9+ handle the full integrated serve path).
 */

import { Hipp0HttpServer } from '@openhipp0/bridge';
import type { CommandResult } from '../types.js';

export interface ServeOptions {
  port?: number;
  host?: string;
  /** When true, start() returns immediately after binding (tests). */
  once?: boolean;
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

  if (opts.once) {
    await server.stop();
    return { exitCode: 0, stdout: [banner, 'stopped (--once)'], data: addr };
  }

  // Keep the process alive; SIGINT / SIGTERM trigger a graceful stop.
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      server.stop().finally(resolve);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
  return { exitCode: 0, stdout: [banner, 'stopped'] };
}
