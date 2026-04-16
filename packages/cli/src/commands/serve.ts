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

import {
  Hipp0HttpServer,
  WebBridge,
  type IncomingMessage,
  type OutgoingMessage,
  type Route,
} from '@openhipp0/bridge';
import type { CommandResult } from '../types.js';

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
  /** Handler for inbound chat frames; defaults to an echo responder. */
  onMessage?: (msg: IncomingMessage) => Promise<OutgoingMessage | undefined> | OutgoingMessage | undefined;
  /** Pre-built routeTable for tests / advanced wiring. */
  routeTable?: readonly Route[];
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
    const configRoutes = buildConfigRoutes(opts.apiToken ?? process.env['HIPP0_API_TOKEN']);
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
    routeTable = [...built.routes, ...configRoutes, healthAlias];
    closeDb = built.close;
  }

  const server = new Hipp0HttpServer({
    port,
    host,
    routeTable,
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
      webBridge = new WebBridge({ httpServer: http, path: '/ws', attachOnly: true });
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
function buildConfigRoutes(apiToken: string | undefined): readonly Route[] {
  const wrap = (handler: Route['handler']): Route['handler'] =>
    apiToken
      ? async (ctx) => {
          const raw = (ctx.req as { headers?: Record<string, string | undefined> }).headers?.['authorization'];
          if (raw !== `Bearer ${apiToken}`) {
            return { status: 401, body: { error: 'unauthorized' } };
          }
          return handler(ctx);
        }
      : handler;

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

function sanitizeConfig(cfg: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cfg)) {
    if (/key|secret|token|password/i.test(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      out[k] = sanitizeConfig(v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

async function buildApiRoutes(opts: {
  databaseUrl: string | undefined;
  apiToken: string | undefined;
}): Promise<{ routes: Route[]; close: () => void }> {
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
