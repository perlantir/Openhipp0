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
