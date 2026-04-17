/**
 * Hipp0HttpServer — a minimal HTTP server for the production gateway.
 *
 * Exposes GET /health + two route forms:
 *   - Exact-match string routes via `routes: { "GET /version": handler }`
 *   - Pattern routes via `routeTable: [{ method, path, handler }]` with
 *     `:param` placeholders (e.g. `/api/decisions/:id`).
 *
 * Hardened surface (Phase 3-H1):
 *   - Security headers on every response (XFO/XCTO/Referrer-Policy/CSP/HSTS).
 *   - Pre-route middlewares (rate-limit + auth run before body parse).
 *   - OPTIONS (CORS preflight) + HEAD (GET-without-body) handlers.
 *   - Opaque 500s with correlation IDs; full error logged to `onError`.
 *   - Generic JSON parse errors (no parser-position leak).
 */

import { randomUUID } from 'node:crypto';
import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';

export interface RouteHandlerContext {
  req: IncomingMessage;
  params: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
  /** Server-assigned correlation id. Appears in error responses + onError logs. */
  requestId: string;
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

/**
 * Pre-route middleware. Runs before body parse + route matching. Return
 * `undefined` to continue; return a `RouteResponse` to short-circuit
 * (e.g. rate-limit 429 / auth 401). Attach extra data to `ctx` as needed.
 */
export type PreRouteMiddleware = (
  ctx: { req: IncomingMessage; method: string; pathname: string; requestId: string },
) => Promise<RouteResponse | undefined> | RouteResponse | undefined;

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
  /**
   * Runs in order before route matching + body parse. Use for rate-limit,
   * auth, logging. Any middleware returning a `RouteResponse` short-circuits
   * the request.
   */
  preRouteMiddlewares?: readonly PreRouteMiddleware[];
  /**
   * Allowed CORS origins for OPTIONS preflight + `Access-Control-Allow-Origin`
   * on cross-origin responses. Empty/undefined = CORS disabled (same-origin
   * only — the default, safer choice for a local-first agent).
   */
  allowedOrigins?: readonly string[];
  /** Emits full internal errors with the correlation id. Default: console.error. */
  onError?: (err: unknown, requestId: string, ctx: { method: string; pathname: string }) => void;
  /** Override the security headers baseline (extends rather than replaces). */
  extraSecurityHeaders?: Record<string, string>;
}

interface CompiledRoute {
  method: string;
  regex: RegExp;
  paramNames: readonly string[];
  handler: RouteHandler;
}

/**
 * Default response-level security headers. Applied to every response,
 * including 4xx/5xx + OPTIONS. Overridable via `extraSecurityHeaders`.
 *
 * Notes:
 *   - `default-src 'none'` is safe for a pure JSON API surface; the dashboard
 *     runs on a different origin so this CSP never restricts it.
 *   - HSTS is safe even on http://127.0.0.1 — browsers ignore HSTS over plain
 *     HTTP, so it's a no-op in dev and correct in prod TLS.
 */
const DEFAULT_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=63072000; includeSubDomains',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
};

export class Hipp0HttpServer {
  private server: HttpServer | undefined;
  private readonly port: number;
  private readonly host: string;
  private readonly healthProbe: Hipp0HttpServerConfig['healthProbe'];
  private readonly routes: NonNullable<Hipp0HttpServerConfig['routes']>;
  private readonly routeTable: readonly CompiledRoute[];
  private readonly maxBodyBytes: number;
  private readonly preRouteMiddlewares: readonly PreRouteMiddleware[];
  private readonly allowedOrigins: readonly string[];
  private readonly securityHeaders: Readonly<Record<string, string>>;
  private readonly onError: NonNullable<Hipp0HttpServerConfig['onError']>;

  constructor(cfg: Hipp0HttpServerConfig = {}) {
    this.port = cfg.port ?? 3100;
    this.host = cfg.host ?? '0.0.0.0';
    this.healthProbe = cfg.healthProbe;
    this.routes = cfg.routes ?? {};
    this.routeTable = (cfg.routeTable ?? []).map(compileRoute);
    this.maxBodyBytes = cfg.maxBodyBytes ?? 1 * 1024 * 1024;
    this.preRouteMiddlewares = cfg.preRouteMiddlewares ?? [];
    this.allowedOrigins = cfg.allowedOrigins ?? [];
    this.securityHeaders = { ...DEFAULT_SECURITY_HEADERS, ...(cfg.extraSecurityHeaders ?? {}) };
    this.onError =
      cfg.onError ??
      ((err, rid, ctx) => {
        console.error(`[hipp0-http:${rid}] ${ctx.method} ${ctx.pathname}`, err);
      });
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
    const method = (req.method ?? 'GET').toUpperCase();
    const pathname = url.split('?')[0] ?? '/';
    const requestId = randomUUID();
    res.setHeader('x-request-id', requestId);

    // CORS preflight — answer with an empty 204 + negotiated headers.
    if (method === 'OPTIONS') {
      return this.handleOptions(req, res);
    }

    // /health is public + cheap; run before middlewares so rate-limit + auth
    // don't gate liveness probes from docker/k8s/systemd.
    if ((method === 'GET' || method === 'HEAD') && (url === '/health' || url.startsWith('/health?'))) {
      try {
        const body = this.healthProbe
          ? await this.healthProbe()
          : { status: 'ok' as const, checks: [] };
        return this.send(res, req, 200, method === 'HEAD' ? undefined : body);
      } catch (err) {
        this.onError(err, requestId, { method, pathname });
        return this.send(res, req, 503, method === 'HEAD' ? undefined : { status: 'fail', ref: requestId });
      }
    }

    // Pre-route middlewares (rate-limit + auth). Any middleware may short-
    // circuit before we even read the body — the whole point of running here.
    try {
      for (const mw of this.preRouteMiddlewares) {
        const short = await mw({ req, method, pathname, requestId });
        if (short) return this.sendResponse(res, req, short);
      }
    } catch (err) {
      this.onError(err, requestId, { method, pathname });
      return this.send(res, req, 500, { error: 'internal error', ref: requestId });
    }

    const key = `${method} ${pathname}`;
    const legacy = this.routes[key];
    if (legacy) {
      try {
        const body = await legacy(req);
        return this.send(res, req, 200, body);
      } catch (err) {
        this.onError(err, requestId, { method, pathname });
        return this.send(res, req, 500, { error: 'internal error', ref: requestId });
      }
    }

    // HEAD dispatches to the GET handler with body suppression.
    const matchMethod = method === 'HEAD' ? 'GET' : method;

    for (const route of this.routeTable) {
      if (route.method !== matchMethod) continue;
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
        const out = await route.handler({ req, params, query, body, requestId });
        if (method === 'HEAD') return this.sendResponse(res, req, { ...out, body: undefined });
        return this.sendResponse(res, req, out);
      } catch (err) {
        if (err instanceof HttpError) {
          return this.send(res, req, err.status, { error: err.safeMessage });
        }
        this.onError(err, requestId, { method, pathname });
        return this.send(res, req, 500, { error: 'internal error', ref: requestId });
      }
    }

    return this.send(res, req, 404, { error: 'not found' });
  }

  private handleOptions(req: IncomingMessage, res: ServerResponse): void {
    const origin = (req.headers['origin'] as string | undefined) ?? '';
    this.applySecurityHeaders(res);
    if (this.allowedOrigins.length > 0 && this.allowedOrigins.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
      res.setHeader('access-control-allow-methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      res.setHeader('access-control-allow-headers', 'authorization, content-type, x-hipp0-project-id');
      res.setHeader('access-control-max-age', '600');
    }
    res.statusCode = 204;
    res.end();
  }

  private applySecurityHeaders(res: ServerResponse): void {
    for (const [k, v] of Object.entries(this.securityHeaders)) res.setHeader(k, v);
  }

  private applyCors(req: IncomingMessage, res: ServerResponse): void {
    const origin = (req.headers['origin'] as string | undefined) ?? '';
    if (this.allowedOrigins.length > 0 && this.allowedOrigins.includes(origin)) {
      res.setHeader('access-control-allow-origin', origin);
      res.setHeader('vary', 'Origin');
    }
  }

  private send(res: ServerResponse, req: IncomingMessage, status: number, body: unknown): void {
    res.statusCode = status;
    this.applySecurityHeaders(res);
    this.applyCors(req, res);
    res.setHeader('content-type', 'application/json');
    if (body === undefined) {
      res.end();
      return;
    }
    res.end(JSON.stringify(body));
  }

  private sendResponse(res: ServerResponse, req: IncomingMessage, out: RouteResponse): void {
    const status = out.status ?? 200;
    res.statusCode = status;
    this.applySecurityHeaders(res);
    this.applyCors(req, res);
    res.setHeader('content-type', 'application/json');
    if (out.headers) {
      for (const [k, v] of Object.entries(out.headers)) res.setHeader(k, v);
    }
    res.end(out.body === undefined ? '' : JSON.stringify(out.body));
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
  } catch {
    throw new HttpError(400, 'invalid JSON body');
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
  /** Client-safe message (never leaks internals). */
  readonly safeMessage: string;
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.safeMessage = message;
  }
}

// ─── built-in middlewares ────────────────────────────────────────────────

/**
 * In-memory token-bucket rate limiter keyed on a caller-supplied identity
 * (defaults to `req.socket.remoteAddress`). Returns a `PreRouteMiddleware`.
 *
 * NOT a distributed limiter — one process only. For multi-replica deploys,
 * terminate rate-limiting at a reverse proxy (nginx / Cloudflare) instead.
 *
 * Burst = `capacity`; sustained rate = `capacity / windowMs * 60000` per min.
 * Default: 120 requests/min with a burst of 40 (reasonable for a dashboard
 * that polls /api/memory/stats every few seconds + occasional writes).
 */
export interface RateLimitOptions {
  capacity?: number;
  /** Refill window; after this many ms, the bucket has refilled from empty. */
  windowMs?: number;
  /** Identity resolver. Default: `req.socket.remoteAddress`. */
  identity?: (req: IncomingMessage) => string;
  /** Paths to skip (exact-match + prefix). /health is always exempt. */
  skipPaths?: readonly string[];
  /** Override `Date.now` (tests). */
  now?: () => number;
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export function createRateLimiter(opts: RateLimitOptions = {}): PreRouteMiddleware {
  const capacity = opts.capacity ?? 40;
  const windowMs = opts.windowMs ?? 20_000;
  const refillPerMs = capacity / windowMs;
  const now = opts.now ?? (() => Date.now());
  const identity = opts.identity ?? ((req) => {
    // x-forwarded-for wins when present (standard reverse-proxy header).
    const xff = req.headers['x-forwarded-for'];
    const first = (Array.isArray(xff) ? xff[0] : xff)?.split(',')[0]?.trim();
    return first || (req.socket.remoteAddress ?? 'unknown');
  });
  const skip = new Set<string>(['/health', ...(opts.skipPaths ?? [])]);
  const buckets = new Map<string, Bucket>();

  return (ctx) => {
    if (skip.has(ctx.pathname) || [...skip].some((s) => ctx.pathname.startsWith(s + '/'))) return undefined;
    const key = identity(ctx.req);
    const t = now();
    let b = buckets.get(key);
    if (!b) {
      b = { tokens: capacity, lastRefill: t };
      buckets.set(key, b);
    } else {
      const elapsed = t - b.lastRefill;
      if (elapsed > 0) {
        b.tokens = Math.min(capacity, b.tokens + elapsed * refillPerMs);
        b.lastRefill = t;
      }
    }
    if (b.tokens < 1) {
      const msUntilOne = Math.ceil((1 - b.tokens) / refillPerMs);
      return {
        status: 429,
        headers: {
          'retry-after': String(Math.max(1, Math.round(msUntilOne / 1000))),
          'x-ratelimit-limit': String(capacity),
          'x-ratelimit-remaining': '0',
        },
        body: { error: 'rate limit exceeded' },
      };
    }
    b.tokens -= 1;
    return undefined;
  };
}
