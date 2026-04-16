/**
 * REST API route factory — the six endpoints the Python SDK targets.
 *
 *   POST   /api/decisions              create
 *   GET    /api/decisions              list by project + status
 *   GET    /api/decisions/:id          fetch one
 *   PATCH  /api/decisions/:id          update
 *   GET    /api/memory/search          FTS5 search
 *   GET    /api/memory/stats           row counts
 *   GET    /api/skills                 list skills (optionally filtered by project/agent)
 *
 * Returns a Route[] that plugs directly into Hipp0HttpServer.routeTable.
 * The handler contract is the structural shape used by the bridge package
 * — we redefine it locally to avoid importing from bridge (which would
 * invert the package-boundary matrix: memory cannot import bridge).
 */

import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import type { HipppoDb } from '../db/index.js';
import {
  createDecision,
  getDecision,
  updateDecision,
  listByProject,
  type DecisionStatus,
} from '../decisions/index.js';
import { searchSessions, escapeFts5 } from '../recall/index.js';
import { skills as skillsTable } from '../db/schema.js';

// ─── route shape (structural; matches @openhipp0/bridge.Route) ───────────

export interface ApiRouteContext {
  params: Record<string, string>;
  query: Record<string, string>;
  body?: unknown;
}

export interface ApiRouteResponse {
  status?: number;
  body?: unknown;
}

export interface ApiRoute {
  method: string;
  path: string;
  handler: (ctx: ApiRouteContext) => Promise<ApiRouteResponse> | ApiRouteResponse;
}

// ─── schemas ─────────────────────────────────────────────────────────────

const CreateDecisionBody = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  reasoning: z.string().min(1),
  madeBy: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
  affects: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
});

const UpdateDecisionBody = z.object({
  title: z.string().min(1).optional(),
  reasoning: z.string().min(1).optional(),
  confidence: z.enum(['high', 'medium', 'low']).optional(),
  tags: z.array(z.string()).optional(),
  status: z.enum(['active', 'superseded', 'rejected']).optional(),
});

// ─── factory ─────────────────────────────────────────────────────────────

export interface ApiRouteOptions {
  /** Drizzle DB handle. */
  db: HipppoDb;
  /** Optional — used for createDecision embeddings. */
  embeddingProvider?: Parameters<typeof createDecision>[2] extends { embeddingProvider?: infer E }
    ? E
    : never;
  /** Bearer token enforcement. When set, every route requires matching
   *  `Authorization: Bearer <token>` — returns 401 otherwise. */
  requireBearer?: string;
  /** Optional authorization header (for tests that thread the context
   *  through a mock req). Called with the handler context and must return
   *  true to allow the request. */
  authorize?: (ctx: ApiRouteContext & { authorization?: string }) => boolean;
}

export function createApiRoutes(opts: ApiRouteOptions): ApiRoute[] {
  const routes: ApiRoute[] = [
    {
      method: 'POST',
      path: '/api/decisions',
      async handler(ctx) {
        const input = CreateDecisionBody.parse(ctx.body ?? {});
        const recordOpts = opts.embeddingProvider
          ? { embeddingProvider: opts.embeddingProvider }
          : undefined;
        const d = await createDecision(opts.db, input, recordOpts);
        return { status: 201, body: d };
      },
    },
    {
      method: 'GET',
      path: '/api/decisions',
      async handler(ctx) {
        const projectId = ctx.query['projectId'];
        if (!projectId) return { status: 400, body: { error: 'missing ?projectId=' } };
        const status = parseStatus(ctx.query['status']);
        const limit = parseInt(ctx.query['limit'] ?? '50', 10);
        const offset = parseInt(ctx.query['offset'] ?? '0', 10);
        const listOpts: Parameters<typeof listByProject>[2] = {
          limit: isFinite(limit) ? limit : 50,
          offset: isFinite(offset) ? offset : 0,
        };
        if (status !== undefined) listOpts.status = status;
        const rows = await listByProject(opts.db, projectId, listOpts);
        return { body: rows };
      },
    },
    {
      method: 'GET',
      path: '/api/decisions/:id',
      async handler(ctx) {
        const id = ctx.params['id'];
        if (!id) return { status: 400, body: { error: 'missing :id' } };
        const d = await getDecision(opts.db, id);
        if (!d) return { status: 404, body: { error: 'decision not found', id } };
        return { body: d };
      },
    },
    {
      method: 'PATCH',
      path: '/api/decisions/:id',
      async handler(ctx) {
        const id = ctx.params['id'];
        if (!id) return { status: 400, body: { error: 'missing :id' } };
        const patch = UpdateDecisionBody.parse(ctx.body ?? {});
        const updated = await updateDecision(opts.db, id, patch);
        if (!updated) return { status: 404, body: { error: 'decision not found', id } };
        return { body: updated };
      },
    },
    {
      method: 'GET',
      path: '/api/memory/search',
      handler(ctx) {
        const projectId = ctx.query['projectId'];
        const q = ctx.query['q'];
        if (!projectId) return { status: 400, body: { error: 'missing ?projectId=' } };
        if (!q) return { status: 400, body: { error: 'missing ?q=' } };
        const agentId = ctx.query['agentId'];
        const userId = ctx.query['userId'];
        const limit = parseInt(ctx.query['limit'] ?? '10', 10);
        const searchOpts: Parameters<typeof searchSessions>[3] = {
          limit: isFinite(limit) ? limit : 10,
        };
        if (agentId) searchOpts.agentId = agentId;
        if (userId) searchOpts.userId = userId;
        const hits = searchSessions(opts.db, projectId, escapeFts5(q), searchOpts);
        return { body: hits };
      },
    },
    {
      method: 'GET',
      path: '/api/memory/stats',
      handler() {
        const client = opts.db.$client;
        const count = (sql: string): number => {
          const row = client.prepare(sql).get() as { c: number } | undefined;
          return row?.c ?? 0;
        };
        return {
          body: {
            decisions: count('SELECT COUNT(*) AS c FROM decisions'),
            edges: count('SELECT COUNT(*) AS c FROM decision_edges'),
            memoryEntries: count('SELECT COUNT(*) AS c FROM memory_entries'),
            sessionHistory: count('SELECT COUNT(*) AS c FROM session_history'),
            skills: count('SELECT COUNT(*) AS c FROM skills'),
            userModels: count('SELECT COUNT(*) AS c FROM user_models'),
          },
        };
      },
    },
    {
      method: 'GET',
      path: '/api/skills',
      async handler(ctx) {
        const projectId = ctx.query['projectId'];
        const agentId = ctx.query['agentId'];
        const limit = parseInt(ctx.query['limit'] ?? '50', 10);
        const conditions = [];
        if (projectId) conditions.push(eq(skillsTable.projectId, projectId));
        if (agentId) conditions.push(eq(skillsTable.agentId, agentId));
        const where = conditions.length > 0 ? (conditions.length === 1 ? conditions[0] : and(...conditions)) : undefined;
        const query = opts.db
          .select({
            id: skillsTable.id,
            title: skillsTable.title,
            projectId: skillsTable.projectId,
            agentId: skillsTable.agentId,
            triggerPattern: skillsTable.triggerPattern,
            timesUsed: skillsTable.timesUsed,
            timesImproved: skillsTable.timesImproved,
            createdAt: skillsTable.createdAt,
          })
          .from(skillsTable)
          .orderBy(desc(skillsTable.timesUsed))
          .limit(isFinite(limit) ? Math.min(limit, 500) : 50);
        const rows = await (where ? query.where(where) : query);
        return { body: rows };
      },
    },
  ];

  // Bearer-auth wrapper if requested.
  if (opts.requireBearer) {
    const token = opts.requireBearer;
    return routes.map((r) => ({
      ...r,
      async handler(ctx) {
        // Caller passes the req so we can read headers. The bridge's adapter
        // sets `ctx.query['_authorization']` to the raw header for us, but
        // the standard Hipp0HttpServer path doesn't; we check `opts.authorize`
        // as an escape hatch, otherwise read the raw Authorization header
        // off the req object when the bridge exposes it.
        const reqAny = (ctx as unknown as { req?: { headers?: Record<string, string | undefined> } }).req;
        const raw = reqAny?.headers?.['authorization'] ?? undefined;
        const expected = `Bearer ${token}`;
        if (opts.authorize) {
          const authCtx: ApiRouteContext & { authorization?: string } = { ...ctx };
          if (raw !== undefined) authCtx.authorization = raw;
          if (!opts.authorize(authCtx)) return { status: 401, body: { error: 'unauthorized' } };
        } else if (raw !== expected) {
          return { status: 401, body: { error: 'unauthorized' } };
        }
        return r.handler(ctx);
      },
    }));
  }

  return routes;
}

function parseStatus(value: string | undefined): DecisionStatus | undefined {
  if (!value) return undefined;
  if (['active', 'superseded', 'rejected'].includes(value)) return value as DecisionStatus;
  return undefined;
}
