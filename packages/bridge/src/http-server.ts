/**
 * Hipp0HttpServer — a minimal HTTP server for the production gateway.
 *
 * Exposes GET /health + two route forms:
 *   - Exact-match string routes via `routes: { "GET /version": handler }`
 *   - Pattern routes via `routeTable: [{ method, path, handler }]` with
 *     `:param` placeholders (e.g. `/api/decisions/:id`).
 *
 * The HealthReport shape matches @openhipp0/watchdog's HealthRegistry so
 * docker healthcheck / Docker Compose / systemd can probe it directly.
 */

import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface RouteHandlerContext {
  req: IncomingMessage;
  params: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
}

export interface RouteResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export type RouteHandler = (ctx: RouteHandlerContext) => Promise<RouteResponse> | RouteResponse;

export interface Route {
  method: string;
  /** Path with optional `:param` placeholders. */
  path: string;
  handler: RouteHandler;
}

export interface Hipp0HttpServerConfig {
  port?: number;
  host?: string;
  /** Called for GET /health. Must return a JSON-serializable body. */
  healthProbe?: () => Promise<unknown> | unknown;
  /** Exact-match routes (legacy). Key is `"METHOD /path"`. */
  routes?: Record<string, (req: IncomingMessage) => Promise<unknown> | unknown>;
  /** Pattern-match routes with `:param` placeholders + structured responses. */
  routeTable?: readonly Route[];
  /** Max JSON body size accepted on write requests. Default 1 MiB. */
  maxBodyBytes?: number;
}

interface CompiledRoute {
  method: string;
  regex: RegExp;
  paramNames: readonly string[];
  handler: RouteHandler;
}

export class Hipp0HttpServer {
  private server: HttpServer | undefined;
  private readonly port: number;
  private readonly host: string;
  private readonly healthProbe: Hipp0HttpServerConfig['healthProbe'];
  private readonly routes: NonNullable<Hipp0HttpServerConfig['routes']>;
  private readonly routeTable: readonly CompiledRoute[];
  private readonly maxBodyBytes: number;

  constructor(cfg: Hipp0HttpServerConfig = {}) {
    this.port = cfg.port ?? 3100;
    this.host = cfg.host ?? '0.0.0.0';
    this.healthProbe = cfg.healthProbe;
    this.routes = cfg.routes ?? {};
    this.routeTable = (cfg.routeTable ?? []).map(compileRoute);
    this.maxBodyBytes = cfg.maxBodyBytes ?? 1 * 1024 * 1024;
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

  /** Expose the underlying HTTP server so WebBridge (or any other WS
   *  upgrade handler) can share the port. Returns undefined when the
   *  server hasn't been started yet. */
  getHttpServer(): HttpServer | undefined {
    return this.server;
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';
    const pathname = url.split('?')[0] ?? '/';

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

    const key = `${method} ${pathname}`;
    const legacy = this.routes[key];
    if (legacy) {
      try {
        const body = await legacy(req);
        return send(res, 200, body);
      } catch (err) {
        return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    for (const route of this.routeTable) {
      if (route.method !== method) continue;
      const m = route.regex.exec(pathname);
      if (!m) continue;
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        const v = m[i + 1];
        if (v !== undefined) params[name] = decodeURIComponent(v);
      });
      try {
        const body = await readJsonBody(req, this.maxBodyBytes);
        const query = parseQuery(url);
        const out = await route.handler({ req, params, query, body });
        return sendResponse(res, out);
      } catch (err) {
        if (err instanceof HttpError) return send(res, err.status, { error: err.message });
        return send(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    return send(res, 404, { error: 'not found', path: url });
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

function compileRoute(r: Route): CompiledRoute {
  const paramNames: string[] = [];
  const pattern = r.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name: string) => {
    paramNames.push(name);
    return '([^/?#]+)';
  });
  return {
    method: r.method.toUpperCase(),
    regex: new RegExp(`^${pattern}$`),
    paramNames,
    handler: r.handler,
  };
}

async function readJsonBody(req: IncomingMessage, limit: number): Promise<unknown> {
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'DELETE') return undefined;
  const contentType = req.headers['content-type'] ?? '';
  if (!contentType.includes('application/json')) return undefined;
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > limit) throw new HttpError(413, 'request body too large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return undefined;
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (err) {
    throw new HttpError(400, `invalid JSON body: ${(err as Error).message}`);
  }
}

function parseQuery(url: string): Record<string, string> {
  const qIdx = url.indexOf('?');
  if (qIdx < 0) return {};
  const params = new URLSearchParams(url.slice(qIdx + 1));
  const out: Record<string, string> = {};
  for (const [k, v] of params) out[k] = v;
  return out;
}

export class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

function sendResponse(res: ServerResponse, out: RouteResponse): void {
  const status = out.status ?? 200;
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  if (out.headers) {
    for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
  }
  res.end(out.body === undefined ? '' : JSON.stringify(out.body));
}
