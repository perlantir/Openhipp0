/**
 * Hipp0HttpServer — a minimal HTTP server for the production gateway.
 *
 * It exposes:
 *   GET /health  → { status: "ok" | "warn" | "fail", checks: [...] }
 *
 * and optionally additional endpoints if the caller wires them in. The
 * JSON-over-HTTP API surface that the Python SDK targets (/api/decisions,
 * /api/memory/...) is intentionally NOT implemented here yet — those
 * endpoints land alongside the REST adapter in Phase 9+.
 *
 * The HealthReport shape matches @openhipp0/watchdog's HealthRegistry so
 * docker healthcheck / Docker Compose / systemd can probe it directly.
 */

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface Hipp0HttpServerConfig {
  port?: number;
  host?: string;
  /** Called for GET /health. Must return a JSON-serializable body. */
  healthProbe?: () => Promise<unknown> | unknown;
  /** Attach extra JSON route handlers. Key is "GET /path"; value returns a body. */
  routes?: Record<string, (req: IncomingMessage) => Promise<unknown> | unknown>;
}

export class Hipp0HttpServer {
  private server: HttpServer | undefined;
  private readonly port: number;
  private readonly host: string;
  private readonly healthProbe: Hipp0HttpServerConfig['healthProbe'];
  private readonly routes: NonNullable<Hipp0HttpServerConfig['routes']>;

  constructor(cfg: Hipp0HttpServerConfig = {}) {
    this.port = cfg.port ?? 3100;
    this.host = cfg.host ?? '0.0.0.0';
    this.healthProbe = cfg.healthProbe;
    this.routes = cfg.routes ?? {};
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server) return this.address();
    this.server = createServer((req, res) => {
      void this.handle(req, res);
    });
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject);
      this.server!.listen(this.port, this.host, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });
    return this.address();
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve) => this.server!.close(() => resolve()));
    this.server = undefined;
  }

  address(): { host: string; port: number } {
    const addr = this.server?.address();
    if (typeof addr === 'object' && addr !== null) {
      return { host: addr.address, port: addr.port };
    }
    return { host: this.host, port: this.port };
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (method === 'GET' && (url === '/health' || url.startsWith('/health?'))) {
      try {
        const body = this.healthProbe
          ? await this.healthProbe()
          : { status: 'ok' as const, checks: [] };
        return send(res, 200, body);
      } catch (err) {
        return send(res, 503, {
          status: 'fail',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const key = `${method} ${url.split('?')[0]}`;
    const handler = this.routes[key];
    if (handler) {
      try {
        const body = await handler(req);
        return send(res, 200, body);
      } catch (err) {
        return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    return send(res, 404, { error: 'not found', path: url });
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}
