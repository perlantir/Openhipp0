import { describe, expect, it } from 'vitest';
import { buildRlsMiddleware, chainMiddleware, type RlsDb } from '../../src/commands/rls-middleware.js';
import { buildApiAuth, type AuthResolution } from '../../src/commands/api-auth.js';

function fakeDb(): RlsDb & { calls: Array<[string, readonly unknown[] | undefined]> } {
  const calls: Array<[string, readonly unknown[] | undefined]> = [];
  return {
    calls,
    async execute(sql, params) {
      calls.push([sql, params]);
    },
  };
}

function ctx(auth: AuthResolution | undefined, headers: Record<string, string> = {}) {
  const req: { auth?: AuthResolution; headers: Record<string, string> } = { headers };
  if (auth) req.auth = auth;
  return { req, params: {}, query: {}, body: undefined };
}

describe('buildRlsMiddleware', () => {
  it('noop when auth is absent (unauthenticated routes)', async () => {
    const db = fakeDb();
    const rls = buildRlsMiddleware({ getDb: () => db });
    const handler = rls(async () => ({ body: { ok: true } }));
    const res = await handler(ctx(undefined));
    expect(res).toEqual({ body: { ok: true } });
    expect(db.calls).toHaveLength(0);
  });

  it('noop for static ops callers (no tenant context to set)', async () => {
    const db = fakeDb();
    const rls = buildRlsMiddleware({ getDb: () => db });
    const handler = rls(async () => ({ body: { ok: true } }));
    await handler(ctx({ kind: 'static' }));
    expect(db.calls).toHaveLength(0);
  });

  it('noop when db resolves to null (SQLite deployment)', async () => {
    const rls = buildRlsMiddleware({ getDb: () => null });
    const handler = rls(async () => ({ body: { ok: true } }));
    await handler(ctx({ kind: 'agent-key', organizationId: 'org-a' }));
    // Didn't throw; still returned response.
  });

  it('sets tenant + project + user session vars for agent-key callers', async () => {
    const db = fakeDb();
    const rls = buildRlsMiddleware({ getDb: () => db });
    const handler = rls(async () => ({ body: { ok: true } }));
    await handler(
      ctx({ kind: 'agent-key', organizationId: 'org-a', agentId: 'agent-1' }, { 'x-hipp0-project-id': 'proj-9' }),
    );

    const set = db.calls.filter((c) => c[1]?.[1] && c[1][1] !== '');
    expect(set).toContainEqual(['SELECT set_config($1, $2, true)', ['app.tenant_id', 'org-a']]);
    expect(set).toContainEqual(['SELECT set_config($1, $2, true)', ['app.project_id', 'proj-9']]);
    expect(set).toContainEqual(['SELECT set_config($1, $2, true)', ['app.user_id', 'agent-1']]);
  });

  it('falls back to defaultProjectId when no header', async () => {
    const db = fakeDb();
    const rls = buildRlsMiddleware({ getDb: () => db, defaultProjectId: 'default-proj' });
    const handler = rls(async () => ({ body: { ok: true } }));
    await handler(ctx({ kind: 'agent-key', organizationId: 'org-a' }));
    expect(db.calls).toContainEqual(['SELECT set_config($1, $2, true)', ['app.project_id', 'default-proj']]);
  });

  it('falls back to tenantId when no header + no default', async () => {
    const db = fakeDb();
    const rls = buildRlsMiddleware({ getDb: () => db });
    const handler = rls(async () => ({ body: { ok: true } }));
    await handler(ctx({ kind: 'agent-key', organizationId: 'org-a' }));
    expect(db.calls).toContainEqual(['SELECT set_config($1, $2, true)', ['app.project_id', 'org-a']]);
  });

  it('resets all session vars after the handler returns', async () => {
    const db = fakeDb();
    const rls = buildRlsMiddleware({ getDb: () => db });
    const handler = rls(async () => ({ body: { ok: true } }));
    await handler(ctx({ kind: 'agent-key', organizationId: 'org-a' }));
    const resetCalls = db.calls.filter((c) => c[1]?.[1] === '');
    const keys = resetCalls.map((c) => c[1]![0]);
    expect(keys).toEqual(expect.arrayContaining(['app.tenant_id', 'app.project_id', 'app.user_id', 'app.role']));
  });

  it('resets session vars even when handler throws (no context bleed)', async () => {
    const db = fakeDb();
    const rls = buildRlsMiddleware({ getDb: () => db });
    const handler = rls(async () => {
      throw new Error('boom');
    });
    await expect(
      handler(ctx({ kind: 'agent-key', organizationId: 'org-a' })),
    ).rejects.toThrow('boom');
    const resetCalls = db.calls.filter((c) => c[1]?.[1] === '');
    expect(resetCalls.length).toBeGreaterThan(0);
  });
});

describe('chainMiddleware', () => {
  it('outer wraps inner wraps handler', async () => {
    const db = fakeDb();
    const auth = buildApiAuth({ staticToken: 'ops' });
    const rls = buildRlsMiddleware({ getDb: () => db });
    const wrap = chainMiddleware(auth, rls);
    const handler = wrap(async (c: { req: { auth?: AuthResolution } }) => ({ body: { k: c.req.auth?.kind } }));

    const unauthorized = await handler({
      req: { headers: {} },
      params: {},
      query: {},
      body: undefined,
    });
    expect(unauthorized.status).toBe(401);

    const ok = await handler({
      req: { headers: { authorization: 'Bearer ops' } },
      params: {},
      query: {},
      body: undefined,
    });
    expect(ok.body).toEqual({ k: 'static' });
    expect(db.calls).toHaveLength(0); // static auth bypasses RLS
  });
});
