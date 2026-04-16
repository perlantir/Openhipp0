import { describe, it, expect, beforeEach } from 'vitest';
import { createClient, runMigrations, type HipppoDb } from '../../src/db/index.js';
import { projects } from '../../src/db/schema.js';
import { createApiRoutes, type ApiRoute } from '../../src/api/index.js';

async function seedProject(db: HipppoDb, id: string) {
  await db.insert(projects).values({ id, name: id }).onConflictDoNothing();
}

function findRoute(routes: ApiRoute[], method: string, path: string): ApiRoute {
  const r = routes.find((r) => r.method === method && r.path === path);
  if (!r) throw new Error(`route ${method} ${path} not found`);
  return r;
}

function call(
  route: ApiRoute,
  opts: { params?: Record<string, string>; query?: Record<string, string>; body?: unknown } = {},
) {
  return route.handler({
    params: opts.params ?? {},
    query: opts.query ?? {},
    ...(opts.body !== undefined && { body: opts.body }),
  });
}

describe('createApiRoutes', () => {
  let db: HipppoDb;

  beforeEach(async () => {
    db = createClient({ databaseUrl: ':memory:' });
    await runMigrations(db);
  });

  it('POST /api/projects creates a project and returns 201', async () => {
    const routes = createApiRoutes({ db });
    const create = findRoute(routes, 'POST', '/api/projects');
    const r = await call(create, { body: { id: 'alpha', name: 'Alpha' } });
    expect(r.status).toBe(201);
    const p = r.body as { id: string; name: string };
    expect(p.id).toBe('alpha');
    expect(p.name).toBe('Alpha');
  });

  it('POST /api/projects auto-generates id when not supplied', async () => {
    const routes = createApiRoutes({ db });
    const create = findRoute(routes, 'POST', '/api/projects');
    const r = await call(create, { body: { name: 'Autogen' } });
    expect(r.status).toBe(201);
    const p = r.body as { id: string; name: string };
    expect(p.id).toBeTruthy();
    expect(p.name).toBe('Autogen');
  });

  it('POST /api/projects rejects invalid id chars', async () => {
    const routes = createApiRoutes({ db });
    const create = findRoute(routes, 'POST', '/api/projects');
    await expect(call(create, { body: { id: 'bad id', name: 'x' } })).rejects.toThrow();
  });

  it('POST /api/projects returns 409 on duplicate id', async () => {
    const routes = createApiRoutes({ db });
    const create = findRoute(routes, 'POST', '/api/projects');
    const first = await call(create, { body: { id: 'dup', name: 'First' } });
    expect(first.status).toBe(201);
    const second = await call(create, { body: { id: 'dup', name: 'Second' } });
    expect(second.status).toBe(409);
  });

  it('POST /api/v1/agent/chat returns 501 when no agentHandler is wired', async () => {
    await seedProject(db, 'p1');
    const routes = createApiRoutes({ db });
    const chat = findRoute(routes, 'POST', '/api/v1/agent/chat');
    const r = await call(chat, {
      body: { projectId: 'p1', message: 'hi' },
    });
    expect(r.status).toBe(501);
  });

  it('POST /api/v1/agent/chat invokes agentHandler + returns the reply', async () => {
    await seedProject(db, 'p1');
    const routes = createApiRoutes({
      db,
      agentHandler: async (req) => ({
        text: `got: ${req.message}`,
        messages: [],
        iterations: 1,
      }),
    });
    const chat = findRoute(routes, 'POST', '/api/v1/agent/chat');
    const r = await call(chat, { body: { projectId: 'p1', message: 'hello' } });
    expect(r.status).toBe(200);
    expect((r.body as { text: string }).text).toBe('got: hello');
  });

  it('POST /api/v1/agent/chat dedups by idempotencyKey within 60 s', async () => {
    await seedProject(db, 'p1');
    let calls = 0;
    const routes = createApiRoutes({
      db,
      agentHandler: async (req) => {
        calls++;
        return { text: `call ${calls}: ${req.message}`, messages: [], iterations: 1 };
      },
    });
    const chat = findRoute(routes, 'POST', '/api/v1/agent/chat');
    const key = 'dedup-key-1';
    const first = await call(chat, { body: { projectId: 'p1', message: 'x', idempotencyKey: key } });
    const second = await call(chat, { body: { projectId: 'p1', message: 'x', idempotencyKey: key } });
    expect(calls).toBe(1);
    expect(first.body).toEqual(second.body);
  });

  it('POST /api/v1/agent/chat rejects missing projectId / message', async () => {
    const routes = createApiRoutes({
      db,
      agentHandler: async () => ({ text: '', messages: [], iterations: 0 }),
    });
    const chat = findRoute(routes, 'POST', '/api/v1/agent/chat');
    const r = await call(chat, { body: { message: 'x' } });
    expect(r.status).toBe(400);
  });

  it('POST /api/feedback stores a row + GET /api/skills/:id/rewards aggregates', async () => {
    await seedProject(db, 'p1');
    const routes = createApiRoutes({ db });
    const feedback = findRoute(routes, 'POST', '/api/feedback');
    const r = await call(feedback, {
      body: {
        projectId: 'p1',
        userId: 'u1',
        skillId: 'sk-1',
        rating: 1,
        source: 'explicit',
      },
    });
    expect(r.status).toBe(201);
    const rewards = findRoute(routes, 'GET', '/api/skills/:id/rewards');
    const ro = await call(rewards, { params: { id: 'sk-1' } });
    const body = ro.body as { reward: number; explicit: { n: number } };
    expect(body.explicit.n).toBe(1);
    // Single row + prior pulls reward toward 0 but above it.
    expect(body.reward).toBeGreaterThan(0);
  });

  it('POST /api/feedback rejects ratings outside {-1, 0, 1}', async () => {
    await seedProject(db, 'p1');
    const routes = createApiRoutes({ db });
    const feedback = findRoute(routes, 'POST', '/api/feedback');
    await expect(
      call(feedback, {
        body: { projectId: 'p1', userId: 'u1', rating: 2, source: 'explicit' },
      }),
    ).rejects.toThrow();
  });

  it('GET /api/projects lists all', async () => {
    await seedProject(db, 'one');
    await seedProject(db, 'two');
    const routes = createApiRoutes({ db });
    const list = findRoute(routes, 'GET', '/api/projects');
    const r = await call(list);
    const rows = r.body as Array<{ id: string }>;
    expect(rows.map((x) => x.id).sort()).toEqual(['one', 'two']);
  });

  it('POST /api/decisions creates + returns 201', async () => {
    await seedProject(db, 'p1');
    const routes = createApiRoutes({ db });
    const create = findRoute(routes, 'POST', '/api/decisions');
    const r = await create.handler({
      params: {},
      query: {},
      body: {
        projectId: 'p1',
        title: 'Adopt Postgres',
        reasoning: 'RLS support + pgvector',
        madeBy: 'user-1',
        confidence: 'high',
      },
    });
    expect(r.status).toBe(201);
    const d = r.body as { id: string; title: string };
    expect(d.id).toBeTruthy();
    expect(d.title).toBe('Adopt Postgres');
  });

  it('POST /api/decisions rejects invalid body', async () => {
    const routes = createApiRoutes({ db });
    const create = findRoute(routes, 'POST', '/api/decisions');
    await expect(call(create, { body: { title: 'missing required fields' } })).rejects.toThrow();
  });

  it('GET /api/decisions lists by projectId with status filter', async () => {
    await seedProject(db, 'p1');
    await seedProject(db, 'p2');
    const routes = createApiRoutes({ db });
    const create = findRoute(routes, 'POST', '/api/decisions');
    await create.handler({
      params: {},
      query: {},
      body: {
        projectId: 'p1',
        title: 'one',
        reasoning: 'first',
        madeBy: 'u',
        confidence: 'medium',
      },
    });
    await create.handler({
      params: {},
      query: {},
      body: {
        projectId: 'p2',
        title: 'two',
        reasoning: 'second',
        madeBy: 'u',
        confidence: 'medium',
      },
    });
    const list = findRoute(routes, 'GET', '/api/decisions');
    const r = await call(list, { query: { projectId: 'p1' } });
    const rows = r.body as Array<{ title: string; projectId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.projectId).toBe('p1');
  });

  it('GET /api/decisions without projectId returns 400', async () => {
    const routes = createApiRoutes({ db });
    const r = await call(findRoute(routes, 'GET', '/api/decisions'), { query: {} });
    expect(r.status).toBe(400);
  });

  it('GET /api/decisions/:id returns 404 for unknown id', async () => {
    const routes = createApiRoutes({ db });
    const r = await call(findRoute(routes, 'GET', '/api/decisions/:id'), { params: { id: 'does-not-exist' } });
    expect(r.status).toBe(404);
  });

  it('PATCH /api/decisions/:id updates + returns the new row', async () => {
    await seedProject(db, 'p1');
    const routes = createApiRoutes({ db });
    const create = findRoute(routes, 'POST', '/api/decisions');
    const created = await create.handler({
      params: {},
      query: {},
      body: {
        projectId: 'p1',
        title: 'original',
        reasoning: 'a',
        madeBy: 'u',
        confidence: 'medium',
      },
    });
    const id = (created.body as { id: string }).id;

    const patch = findRoute(routes, 'PATCH', '/api/decisions/:id');
    const r = await call(patch, { params: { id }, body: { title: 'renamed' } });
    const after = r.body as { title: string };
    expect(after.title).toBe('renamed');
  });

  it('GET /api/memory/stats returns row counts for known tables', async () => {
    const routes = createApiRoutes({ db });
    const r = await call(findRoute(routes, 'GET', '/api/memory/stats'), {});
    const stats = r.body as Record<string, number>;
    expect(stats.decisions).toBe(0);
    expect(stats.sessionHistory).toBeDefined();
    expect(stats.skills).toBeDefined();
  });

  it('GET /api/memory/search returns 400 without projectId / q', async () => {
    const routes = createApiRoutes({ db });
    const search = findRoute(routes, 'GET', '/api/memory/search');
    expect((await call(search, { query: {} })).status).toBe(400);
    expect((await call(search, { query: { projectId: 'p' } })).status).toBe(400);
  });

  it('GET /api/skills returns rows filtered by projectId', async () => {
    await seedProject(db, 'p1');
    await seedProject(db, 'p2');
    // Seed two skills via raw SQL (no createSkill helper publicly exported).
    const client = db.$client;
    client
      .prepare(
        `INSERT INTO skills (id, project_id, agent_id, title, content_md, times_used, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('s1', 'p1', 'agent-x', 'Resolve merge conflicts', '# Skill', 5, new Date().toISOString(), new Date().toISOString());
    client
      .prepare(
        `INSERT INTO skills (id, project_id, agent_id, title, content_md, times_used, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('s2', 'p2', 'agent-y', 'Other', '# Skill', 1, new Date().toISOString(), new Date().toISOString());

    const routes = createApiRoutes({ db });
    const list = findRoute(routes, 'GET', '/api/skills');
    const r = await call(list, { query: { projectId: 'p1' } });
    const rows = r.body as Array<{ id: string; title: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe('s1');
  });

  it('GET /api/audit returns rows newest-first, filterable by agent/action/project', async () => {
    await seedProject(db, 'p1');
    const client = db.$client;
    const insert = client.prepare(
      `INSERT INTO audit_log (id, project_id, agent_id, user_id, action, target_type, target_id, details, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('a1', 'p1', 'claude', null, 'tool.execute', 'tool', 't', '{}', 0.01, '2026-04-16T10:00:00Z');
    insert.run('a2', 'p1', 'claude', null, 'approval.decide', 'approval', 'r1', '{}', 0, '2026-04-16T11:00:00Z');
    insert.run('a3', 'p1', 'other-agent', null, 'tool.execute', 'tool', 't', '{}', 0, '2026-04-16T12:00:00Z');

    const routes = createApiRoutes({ db });
    const list = findRoute(routes, 'GET', '/api/audit');

    // All events, newest first.
    const all = await call(list, { query: { projectId: 'p1' } });
    const events = (all.body as { events: Array<{ id: string; createdAt: string }> }).events;
    expect(events).toHaveLength(3);
    expect(events[0]?.id).toBe('a3');

    // Filter by agentId.
    const byAgent = await call(list, { query: { projectId: 'p1', agentId: 'claude' } });
    expect((byAgent.body as { events: unknown[] }).events).toHaveLength(2);

    // Filter by action.
    const byAction = await call(list, { query: { projectId: 'p1', action: 'approval.decide' } });
    expect((byAction.body as { events: Array<{ id: string }> }).events[0]?.id).toBe('a2');
  });

  it('GET /api/costs aggregates llm_usage rows + returns totals/byProvider/byModel', async () => {
    await seedProject(db, 'p1');
    const client = db.$client;
    const insert = client.prepare(
      `INSERT INTO llm_usage (id, project_id, agent_id, provider, model, input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('u1', 'p1', 'a', 'anthropic', 'haiku', 100, 50, 0.001, '2026-04-16T10:00:00Z');
    insert.run('u2', 'p1', 'a', 'anthropic', 'sonnet', 500, 200, 0.005, '2026-04-16T11:00:00Z');
    insert.run('u3', 'p1', 'b', 'openai', 'gpt-4o', 300, 150, 0.003, '2026-04-16T12:00:00Z');

    const routes = createApiRoutes({ db });
    const costs = findRoute(routes, 'GET', '/api/costs');
    const r = await call(costs, { query: { projectId: 'p1' } });
    const body = r.body as {
      rows: Array<{ id: string }>;
      totals: { costUsd: number; inputTokens: number; outputTokens: number; calls: number };
      byProvider: Array<{ name: string; calls: number; costUsd: number }>;
      byModel: Array<{ name: string; calls: number; costUsd: number }>;
    };
    expect(body.rows).toHaveLength(3);
    expect(body.totals.calls).toBe(3);
    expect(body.totals.costUsd).toBeCloseTo(0.009);
    expect(body.totals.inputTokens).toBe(900);
    expect(body.totals.outputTokens).toBe(400);
    const anthropicBucket = body.byProvider.find((b) => b.name === 'anthropic');
    expect(anthropicBucket?.calls).toBe(2);
    expect(anthropicBucket?.costUsd).toBeCloseTo(0.006);
    expect(body.byModel.find((b) => b.name === 'openai:gpt-4o')?.calls).toBe(1);
  });

  it('GET /api/costs filters by agentId and provider', async () => {
    await seedProject(db, 'p1');
    const client = db.$client;
    const insert = client.prepare(
      `INSERT INTO llm_usage (id, project_id, agent_id, provider, model, input_tokens, output_tokens, cost_usd, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    insert.run('u1', 'p1', 'a', 'anthropic', 'haiku', 100, 50, 0.001, '2026-04-16T10:00:00Z');
    insert.run('u2', 'p1', 'b', 'openai', 'gpt-4o', 100, 50, 0.002, '2026-04-16T11:00:00Z');

    const routes = createApiRoutes({ db });
    const costs = findRoute(routes, 'GET', '/api/costs');
    const byAgent = await call(costs, { query: { agentId: 'a' } });
    expect((byAgent.body as { rows: unknown[] }).rows).toHaveLength(1);
    const byProv = await call(costs, { query: { provider: 'openai' } });
    expect((byProv.body as { rows: Array<{ id: string }> }).rows[0]?.id).toBe('u2');
  });

  it('requireBearer=true enforces auth on every route', async () => {
    const routes = createApiRoutes({ db, requireBearer: 's3cret' });
    const stats = findRoute(routes, 'GET', '/api/memory/stats');
    const r = await call(stats, {});
    expect(r.status).toBe(401);
  });

  it('requireBearer authorize hook can accept the request', async () => {
    const routes = createApiRoutes({
      db,
      requireBearer: 's3cret',
      authorize: (ctx) => ctx.authorization === 'Bearer s3cret',
    });
    const stats = findRoute(routes, 'GET', '/api/memory/stats');
    const r = await stats.handler({
      params: {},
      query: {},
      // hand in the authorization header via the hook's escape-hatch
      req: { headers: { authorization: 'Bearer s3cret' } } as never,
    } as never);
    expect(r.status ?? 200).toBe(200);
  });
});
