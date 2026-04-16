/**
 * `hipp0 serve` — start the production HTTP server on :3100.
 *
 * Exposes GET /health by default. Optional opt-ins:
 *   HIPP0_WITH_WS=1   attach a WebBridge on /ws for chat ingestion
 *   HIPP0_WITH_API=1  mount the REST API (/api/decisions, /api/memory/*)
 *                     — the Python SDK contract lives in docs/api-reference.md
 *
 * All optional subsystems are wired here rather than buried in the server
 * so ops can flip them on from env without editing code.
 */

import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage as HttpIncomingMessage } from 'node:http';
import {
  Hipp0HttpServer,
  WebBridge,
  createRateLimiter,
  type IncomingMessage,
  type OutgoingMessage,
  type Route,
  type PreRouteMiddleware,
  type WebAuthenticator,
} from '@openhipp0/bridge';
import type { CommandResult } from '../types.js';
import { buildVoiceRoutes } from './voice-routes.js';
import { buildPushRoutes } from './push-routes.js';
import { buildWidgetsRoutes } from './widgets-routes.js';
import { buildApiAuth, type ApiKeyResolver, type AuthMiddleware } from './api-auth.js';
import { buildRlsMiddleware, chainMiddleware, type RlsDb } from './rls-middleware.js';
import { buildPairingRoutes } from './pairing-routes.js';

export interface ServeOptions {
  port?: number;
  host?: string;
  /** When true, start() returns immediately after binding (tests). */
  once?: boolean;
  /** Attach a WebBridge on /ws. Defaults to HIPP0_WITH_WS env var. */
  withWs?: boolean;
  /** Mount /api/* routes. Defaults to HIPP0_WITH_API env var. */
  withApi?: boolean;
  /** Database URL used when withApi=true. Default: HIPP0_DATABASE_URL or ~/.hipp0/hipp0.db. */
  databaseUrl?: string;
  /** Bearer token required for API access. Default: HIPP0_API_TOKEN env. */
  apiToken?: string;
  /** Optional per-agent API key resolver (Phase 14 AgentApiKeyStore). */
  apiKeyResolver?: ApiKeyResolver;
  /** Optional Postgres handle for RLS session context. SQLite leaves this null. */
  rlsDb?: RlsDb | null | (() => Promise<RlsDb | null> | RlsDb | null);
  /** Handler for inbound chat frames; defaults to an echo responder. */
  onMessage?: (msg: IncomingMessage) => Promise<OutgoingMessage | undefined> | OutgoingMessage | undefined;
  /** Pre-built routeTable for tests / advanced wiring. */
  routeTable?: readonly Route[];
  /**
   * Per-IP rate limiter. Default: 40 burst / 20s window (≈ 120 req/min).
   * Set to `false` to disable (dev only). `allowedOrigins` drives CORS +
   * WS Origin allowlist; default [] = same-origin only.
   */
  rateLimit?: { capacity?: number; windowMs?: number } | false;
  allowedOrigins?: readonly string[];
}

export async function runServe(opts: ServeOptions = {}): Promise<CommandResult> {
  const port = opts.port ?? Number(process.env['HIPP0_PORT'] ?? 3100);
  const host = opts.host ?? process.env['HIPP0_HOST'] ?? '0.0.0.0';
  const enableApi = opts.withApi ?? envFlag(process.env['HIPP0_WITH_API']);

  let routeTable: readonly Route[] = opts.routeTable ?? [];
  let closeDb: (() => void) | undefined;
  if (enableApi && !opts.routeTable) {
    const built = await buildApiRoutes({
      databaseUrl: opts.databaseUrl ?? process.env['HIPP0_DATABASE_URL'],
      apiToken: opts.apiToken ?? process.env['HIPP0_API_TOKEN'],
    });
    const baseAuth = buildApiAuth({
      staticToken: opts.apiToken ?? process.env['HIPP0_API_TOKEN'],
      keyStore: opts.apiKeyResolver,
    });
    const rlsDbResolver: () => Promise<RlsDb | null> = (() => {
      const provided = opts.rlsDb;
      if (typeof provided === 'function') return async () => (await provided()) ?? null;
      if (provided) return async () => provided;
      return async () => null;
    })();
    const rls = buildRlsMiddleware({
      getDb: rlsDbResolver,
      ...(process.env['HIPP0_DEFAULT_PROJECT_ID'] && {
        defaultProjectId: process.env['HIPP0_DEFAULT_PROJECT_ID'],
      }),
    });
    const auth = chainMiddleware(baseAuth, rls);
    const configRoutes = buildConfigRoutes(auth);
    // /api/health aliases /health so browsers can reach it through the
    // dashboard's /api/* proxy (the root /health can't be proxied without
    // shadowing the React Router route of the same name).
    const healthAlias: Route = {
      method: 'GET',
      path: '/api/health',
      handler: () => ({
        body: {
          status: 'ok',
          checks: [],
          uptime: process.uptime(),
          version: process.env['npm_package_version'] ?? '0.0.0',
          features: {
            api: enableApi,
            ws: opts.withWs ?? envFlag(process.env['HIPP0_WITH_WS']),
          },
        },
      }),
    };
    const voiceRoutes = buildVoiceRoutes(auth);
    const pushRoutes = buildPushRoutes(auth);
    const widgetsRoutes = buildWidgetsRoutes(auth);

    // SQLite-backed pairing stores so pending pairings + paired devices
    // survive a server restart. The raw better-sqlite3 handle is exposed by
    // the Drizzle client as $client.
    const core = await import('@openhipp0/core');
    const { SqlitePairingSessionStore, SqlitePairedDeviceStore } = core.pairing;
    const sessionStore = new SqlitePairingSessionStore(built.rawDb as ConstructorParameters<typeof SqlitePairingSessionStore>[0]);
    const deviceStore = new SqlitePairedDeviceStore(built.rawDb as ConstructorParameters<typeof SqlitePairedDeviceStore>[0]);
    const pairingRoutes = buildPairingRoutes(auth, {
      sessionStore,
      deviceStore,
      serverUrl: process.env['HIPP0_PUBLIC_URL'] ?? `http://${host}:${port}`,
      serverId: process.env['HIPP0_SERVER_ID'] ?? 'self',
    });
    routeTable = [
      ...built.routes,
      ...configRoutes,
      ...voiceRoutes,
      ...pushRoutes,
      ...widgetsRoutes,
      ...pairingRoutes,
      healthAlias,
    ];
    closeDb = built.close;
  }

  const preRouteMiddlewares: PreRouteMiddleware[] = [];
  if (opts.rateLimit !== false) {
    preRouteMiddlewares.push(
      createRateLimiter({
        capacity: opts.rateLimit?.capacity ?? 40,
        windowMs: opts.rateLimit?.windowMs ?? 20_000,
      }),
    );
  }

  const allowedOrigins =
    opts.allowedOrigins ??
    (process.env['HIPP0_ALLOWED_ORIGINS']
      ? process.env['HIPP0_ALLOWED_ORIGINS'].split(',').map((s) => s.trim()).filter(Boolean)
      : []);

  const server = new Hipp0HttpServer({
    port,
    host,
    routeTable,
    preRouteMiddlewares,
    allowedOrigins,
    healthProbe: () => ({
      status: 'ok',
      checks: [],
      uptime: process.uptime(),
      version: process.env['npm_package_version'] ?? '0.0.0',
      features: {
        api: enableApi,
        ws: opts.withWs ?? envFlag(process.env['HIPP0_WITH_WS']),
      },
    }),
  });

  const addr = await server.start();
  const banner = `🦛 hipp0 listening on http://${addr.host}:${addr.port}${enableApi ? ' (+api)' : ''}`;

  const enableWs = opts.withWs ?? envFlag(process.env['HIPP0_WITH_WS']);
  let webBridge: WebBridge | undefined;
  if (enableWs) {
    const http = server.getHttpServer();
    if (http) {
      // WS authenticator — bearer token on query string (?token=...) since
      // browsers can't set Authorization headers on WS upgrades. Uses
      // constant-time compare against the API token.
      const apiToken = opts.apiToken ?? process.env['HIPP0_API_TOKEN'];
      const wsAuthenticator = apiToken ? buildWsAuthenticator(apiToken) : undefined;
      const allowAnonymousWs = !apiToken && envFlag(process.env['HIPP0_WS_ANONYMOUS']);
      webBridge = new WebBridge({
        httpServer: http,
        path: '/ws',
        attachOnly: true,
        allowedOrigins,
        ...(wsAuthenticator && { authenticate: wsAuthenticator }),
        // If we have an API token the WS authenticator gates; otherwise
        // anonymous-by-env only (defaults off for safety).
        ...(!apiToken && { allowAnonymous: allowAnonymousWs }),
      });
      const handler =
        opts.onMessage ??
        (await loadAgentModule(process.env['HIPP0_AGENT_MODULE'])) ??
        echoResponder;
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
    closeDb?.();
    return { exitCode: 0, stdout: [banner, 'stopped (--once)'], data: addr };
  }

  // Keep the process alive; SIGINT / SIGTERM trigger a graceful stop.
  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      const stopper = webBridge ? webBridge.disconnect().catch(() => undefined) : Promise.resolve();
      stopper
        .then(() => server.stop())
        .then(() => closeDb?.())
        .finally(resolve);
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
  return { exitCode: 0, stdout: [banner, 'stopped'] };
}

/**
 * Read-only view of ~/.hipp0/config.json exposed at /api/config,
 * /api/config/agents, /api/config/cron. The dashboard reads these so the
 * Scheduler / Agents / Settings pages have something to render. We sanitize
 * by dropping anything under `llm.apiKey`-like fields even though the
 * current config schema doesn't store them (future-proofing).
 */
function buildConfigRoutes(auth: AuthMiddleware): readonly Route[] {
  const wrap = auth;

  const loadConfig = async (): Promise<Record<string, unknown>> => {
    const { readConfig } = await import('../config.js');
    const cfg = (await readConfig()) as unknown as Record<string, unknown>;
    // Defensive redact — only fields we know are safe ship out.
    return sanitizeConfig(cfg);
  };

  return [
    {
      method: 'GET',
      path: '/api/config',
      handler: wrap(async () => ({ body: await loadConfig() })),
    },
    {
      method: 'GET',
      path: '/api/config/agents',
      handler: wrap(async () => {
        const cfg = await loadConfig();
        return { body: cfg['agents'] ?? [] };
      }),
    },
    {
      method: 'GET',
      path: '/api/config/cron',
      handler: wrap(async () => {
        const cfg = await loadConfig();
        return { body: cfg['cronTasks'] ?? [] };
      }),
    },
  ];
}

/**
 * Defensive redact for config values bound for `/api/config`. Drops
 * well-known secret-shaped keys AND redacts any string value that LOOKS
 * like a credential (sk-ant-, ghp_, hipp0_ak_, JWT-like, long b64). Recurses
 * into arrays (the previous implementation did not).
 */
function sanitizeConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  return sanitizeValue(cfg) as Record<string, unknown>;
}

const SENSITIVE_KEY = /key|secret|token|password|credential|auth|webhook|dsn|privatekey|client[_-]?id|connection/i;
const SECRET_SHAPED = /(sk-ant-api0[0-9]-[A-Za-z0-9_-]{32,}|sk-proj-[A-Za-z0-9_-]{32,}|ghp_[A-Za-z0-9]{20,}|hipp0_ak_[A-Za-z0-9_-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/;

function sanitizeValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sanitizeValue);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) continue;
      out[k] = sanitizeValue(val);
    }
    return out;
  }
  if (typeof v === 'string' && SECRET_SHAPED.test(v)) return '<redacted>';
  return v;
}

/**
 * Build a WebSocket authenticator that accepts `?token=<bearer>` on the
 * upgrade URL (browsers can't set Authorization on WS). Uses SHA-256 +
 * `timingSafeEqual` so token comparison is constant-time.
 */
function buildWsAuthenticator(token: string): WebAuthenticator {
  const expectedHash = Buffer.from(createHash('sha256').update(token).digest('hex'), 'hex');
  return (req: HttpIncomingMessage) => {
    const url = req.url ?? '';
    const qIdx = url.indexOf('?');
    if (qIdx < 0) return null;
    const params = new URLSearchParams(url.slice(qIdx + 1));
    const presented = params.get('token') ?? params.get('t');
    if (!presented) return null;
    const presentedHash = Buffer.from(createHash('sha256').update(presented).digest('hex'), 'hex');
    if (presentedHash.length !== expectedHash.length) return null;
    if (!timingSafeEqual(presentedHash, expectedHash)) return null;
    return { id: `web:auth:${presented.slice(0, 6)}`, name: 'authenticated-web' };
  };
}

async function buildApiRoutes(opts: {
  databaseUrl: string | undefined;
  apiToken: string | undefined;
}): Promise<{
  routes: Route[];
  close: () => void;
  rawDb: unknown;
}> {
  const memory = await import('@openhipp0/memory');
  const client = memory.db.createClient(
    opts.databaseUrl ? { databaseUrl: opts.databaseUrl } : undefined,
  );
  await memory.db.runMigrations(client);
  const routes = memory.createApiRoutes({
    db: client,
    ...(opts.apiToken && { requireBearer: opts.apiToken }),
  });
  // The memory route shape is structurally compatible with bridge's Route —
  // both use { method, path, handler({params, query, body}) -> { status?, body? } }.
  return {
    routes: routes as unknown as Route[],
    close: () => memory.db.closeClient(client),
    rawDb: (client as unknown as { $client: unknown }).$client,
  };
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

/**
 * Optional agent plug-in: if `HIPP0_AGENT_MODULE` names an ES module, we
 * dynamic-import it and use its default export (or named `onMessage`) as
 * the chat handler. Absolute paths and package specifiers both work.
 *
 * Module contract:
 *   export default (msg: IncomingMessage) => Promise<OutgoingMessage|undefined>;
 *   // OR
 *   export function onMessage(msg: IncomingMessage): Promise<OutgoingMessage>;
 */
async function loadAgentModule(
  spec: string | undefined,
): Promise<ServeOptions['onMessage']> {
  if (!spec) return undefined;
  try {
    const mod = (await import(spec)) as {
      default?: NonNullable<ServeOptions['onMessage']>;
      onMessage?: NonNullable<ServeOptions['onMessage']>;
    };
    const handler = mod.default ?? mod.onMessage;
    if (typeof handler !== 'function') {
      process.stderr.write(
        `HIPP0_AGENT_MODULE ${spec} loaded but no default export / onMessage() found; falling back to echo.\n`,
      );
      return undefined;
    }
    return handler;
  } catch (err) {
    process.stderr.write(
      `HIPP0_AGENT_MODULE ${spec} failed to load: ${
        err instanceof Error ? err.message : String(err)
      } — falling back to echo.\n`,
    );
    return undefined;
  }
}
