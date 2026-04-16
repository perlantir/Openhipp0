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

import { createHash, timingSafeEqual } from 'node:crypto';
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
import {
  skills as skillsTable,
  auditLog as auditLogTable,
  llmUsage as llmUsageTable,
  projects as projectsTable,
  userFeedback as userFeedbackTable,
} from '../db/schema.js';
import { computeSkillReward } from '../learning/reward-model.js';

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

const CreateProjectBody = z.object({
  id: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[A-Za-z0-9_.-]+$/)
    .optional(),
  name: z.string().min(1).max(256),
});

const FeedbackBody = z.object({
  projectId: z.string().min(1),
  userId: z.string().min(1).max(256),
  sessionId: z.string().min(1).max(256).optional(),
  turnId: z.string().min(1).max(256).optional(),
  skillId: z.string().min(1).max(256).optional(),
  rating: z.union([z.literal(-1), z.literal(0), z.literal(1)]),
  reason: z.string().max(200).optional(),
  source: z.enum(['explicit', 'implicit']).default('explicit'),
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
      path: '/api/projects',
      async handler(ctx) {
        try {
          const input = CreateProjectBody.parse(ctx.body ?? {});
          const values: { id?: string; name: string } = { name: input.name };
          if (input.id) values.id = input.id;
          const [row] = await opts.db.insert(projectsTable).values(values).returning();
          return { status: 201, body: row };
        } catch (err) {
          // Collapse unique / FK violations into 409 rather than leaking DB text.
          const msg = (err as Error).message ?? '';
          if (/UNIQUE|SQLITE_CONSTRAINT|duplicate/i.test(msg)) {
            return { status: 409, body: { error: 'project already exists' } };
          }
          throw err;
        }
      },
    },
    {
      method: 'GET',
      path: '/api/projects',
      async handler() {
        const rows = await opts.db
          .select({
            id: projectsTable.id,
            name: projectsTable.name,
            createdAt: projectsTable.createdAt,
          })
          .from(projectsTable)
          .orderBy(desc(projectsTable.createdAt))
          .limit(500);
        return { body: rows };
      },
    },
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
        if (!d) return { status: 404, body: { error: 'decision not found' } };
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
        if (!updated) return { status: 404, body: { error: 'decision not found' } };
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
      path: '/api/audit',
      async handler(ctx) {
        const projectId = ctx.query['projectId'];
        const agentId = ctx.query['agentId'];
        const action = ctx.query['action'];
        const limit = clampLimit(ctx.query['limit'], 100, 500);
        const conditions = [];
        if (projectId) conditions.push(eq(auditLogTable.projectId, projectId));
        if (agentId) conditions.push(eq(auditLogTable.agentId, agentId));
        if (action) conditions.push(eq(auditLogTable.action, action));
        const where = conditions.length > 0
          ? (conditions.length === 1 ? conditions[0] : and(...conditions))
          : undefined;
        const query = opts.db
          .select({
            id: auditLogTable.id,
            projectId: auditLogTable.projectId,
            agentId: auditLogTable.agentId,
            userId: auditLogTable.userId,
            action: auditLogTable.action,
            targetType: auditLogTable.targetType,
            targetId: auditLogTable.targetId,
            details: auditLogTable.details,
            costUsd: auditLogTable.costUsd,
            createdAt: auditLogTable.createdAt,
          })
          .from(auditLogTable)
          .orderBy(desc(auditLogTable.createdAt))
          .limit(limit);
        const rows = await (where ? query.where(where) : query);
        return { body: { events: rows } };
      },
    },
    {
      method: 'GET',
      path: '/api/costs',
      async handler(ctx) {
        const projectId = ctx.query['projectId'];
        const agentId = ctx.query['agentId'];
        const provider = ctx.query['provider'];
        const limit = clampLimit(ctx.query['limit'], 200, 1000);
        const conditions = [];
        if (projectId) conditions.push(eq(llmUsageTable.projectId, projectId));
        if (agentId) conditions.push(eq(llmUsageTable.agentId, agentId));
        if (provider) conditions.push(eq(llmUsageTable.provider, provider));
        const where = conditions.length > 0
          ? (conditions.length === 1 ? conditions[0] : and(...conditions))
          : undefined;
        const rowsQuery = opts.db
          .select({
            id: llmUsageTable.id,
            projectId: llmUsageTable.projectId,
            agentId: llmUsageTable.agentId,
            provider: llmUsageTable.provider,
            model: llmUsageTable.model,
            inputTokens: llmUsageTable.inputTokens,
            outputTokens: llmUsageTable.outputTokens,
            costUsd: llmUsageTable.costUsd,
            createdAt: llmUsageTable.createdAt,
          })
          .from(llmUsageTable)
          .orderBy(desc(llmUsageTable.createdAt))
          .limit(limit);
        const rows = await (where ? rowsQuery.where(where) : rowsQuery);

        // Aggregate totals + per-provider + per-model breakdown.
        let totalCostUsd = 0;
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        const byProvider = new Map<string, { costUsd: number; calls: number }>();
        const byModel = new Map<string, { costUsd: number; calls: number }>();
        for (const r of rows) {
          totalCostUsd += r.costUsd ?? 0;
          totalInputTokens += r.inputTokens ?? 0;
          totalOutputTokens += r.outputTokens ?? 0;
          const p = byProvider.get(r.provider) ?? { costUsd: 0, calls: 0 };
          p.costUsd += r.costUsd ?? 0;
          p.calls += 1;
          byProvider.set(r.provider, p);
          const mk = `${r.provider}:${r.model}`;
          const m = byModel.get(mk) ?? { costUsd: 0, calls: 0 };
          m.costUsd += r.costUsd ?? 0;
          m.calls += 1;
          byModel.set(mk, m);
        }
        return {
          body: {
            rows,
            totals: { costUsd: totalCostUsd, inputTokens: totalInputTokens, outputTokens: totalOutputTokens, calls: rows.length },
            byProvider: [...byProvider.entries()].map(([name, v]) => ({ name, ...v })),
            byModel: [...byModel.entries()].map(([name, v]) => ({ name, ...v })),
          },
        };
      },
    },
    {
      method: 'POST',
      path: '/api/feedback',
      async handler(ctx) {
        const input = FeedbackBody.parse(ctx.body ?? {});
        // Rate-limit hint: one rating per (session, turn, user) combo.
        // Enforcement is per-session; duplicates overwrite the previous row
        // so late edits are explicit, not accumulated.
        const values: {
          projectId: string;
          userId: string;
          sessionId?: string;
          turnId?: string;
          skillId?: string;
          rating: number;
          reason?: string;
          source: 'explicit' | 'implicit';
        } = {
          projectId: input.projectId,
          userId: input.userId,
          rating: input.rating,
          source: input.source,
          ...(input.sessionId && { sessionId: input.sessionId }),
          ...(input.turnId && { turnId: input.turnId }),
          ...(input.skillId && { skillId: input.skillId }),
          ...(input.reason && { reason: input.reason }),
        };
        const [row] = await opts.db.insert(userFeedbackTable).values(values).returning();
        return { status: 201, body: row };
      },
    },
    {
      method: 'GET',
      path: '/api/skills/:id/rewards',
      async handler(ctx) {
        const skillId = ctx.params['id'];
        if (!skillId) return { status: 400, body: { error: 'missing :id' } };
        const reward = await computeSkillReward(opts.db, skillId);
        return { body: reward };
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

  // Bearer-auth wrapper if requested. Uses constant-time comparison (SHA-256
  // digests guarantee equal-length buffers for timingSafeEqual).
  if (opts.requireBearer) {
    const tokenHashHex = createHash('sha256').update(opts.requireBearer).digest('hex');
    const tokenHashBuf = Buffer.from(tokenHashHex, 'hex');
    return routes.map((r) => ({
      ...r,
      async handler(ctx) {
        const reqAny = (ctx as unknown as { req?: { headers?: Record<string, string | undefined> } }).req;
        const raw = reqAny?.headers?.['authorization'] ?? undefined;
        if (opts.authorize) {
          const authCtx: ApiRouteContext & { authorization?: string } = { ...ctx };
          if (raw !== undefined) authCtx.authorization = raw;
          if (!opts.authorize(authCtx)) return { status: 401, body: { error: 'unauthorized' } };
        } else {
          const trimmed = raw?.trim();
          if (!trimmed || !trimmed.toLowerCase().startsWith('bearer ')) {
            return { status: 401, body: { error: 'unauthorized' } };
          }
          const presented = trimmed.slice(7).trim();
          const presentedHash = Buffer.from(createHash('sha256').update(presented).digest('hex'), 'hex');
          if (presentedHash.length !== tokenHashBuf.length || !timingSafeEqual(presentedHash, tokenHashBuf)) {
            return { status: 401, body: { error: 'unauthorized' } };
          }
        }
        return r.handler(ctx);
      },
    }));
  }

  return routes;
}

function clampLimit(raw: string | undefined, def: number, max: number): number {
  const n = raw ? parseInt(raw, 10) : def;
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

function parseStatus(value: string | undefined): DecisionStatus | undefined {
  if (!value) return undefined;
  if (['active', 'superseded', 'rejected'].includes(value)) return value as DecisionStatus;
  return undefined;
}
