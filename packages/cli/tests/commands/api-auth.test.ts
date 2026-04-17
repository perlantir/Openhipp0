import { describe, expect, it, vi } from 'vitest';
import { buildApiAuth, type ApiKeyResolver } from '../../src/commands/api-auth.js';

function ctx(auth: string | undefined) {
  return {
    req: { headers: auth ? { authorization: auth } : {} },
    params: {},
    query: {},
    body: undefined,
  };
}

function okHandler() {
  return async () => ({ body: { ok: true } });
}

describe('buildApiAuth', () => {
  it('auth-disabled mode (no token + no keyStore) passes every request through', async () => {
    const auth = buildApiAuth({});
    const handler = auth(okHandler());
    const res = await handler(ctx(undefined));
    expect(res).toEqual({ body: { ok: true } });
  });

  it('static-token mode rejects missing / wrong token', async () => {
    const auth = buildApiAuth({ staticToken: 'secret' });
    const handler = auth(okHandler());
    expect((await handler(ctx(undefined))).status).toBe(401);
    expect((await handler(ctx('Bearer wrong'))).status).toBe(401);
    expect((await handler(ctx('Bearer secret'))).body).toEqual({ ok: true });
  });

  it('static-token mode accepts lowercase "bearer" + trims', async () => {
    const auth = buildApiAuth({ staticToken: 'secret' });
    const handler = auth(okHandler());
    expect((await handler(ctx('  bearer    secret  '))).body).toEqual({ ok: true });
  });

  it('agent-key mode routes hipp0_ak_ tokens through the resolver', async () => {
    const resolver: ApiKeyResolver = {
      verify: vi.fn(async (plaintext) => {
        if (plaintext === 'hipp0_ak_good') {
          return {
            ok: true,
            key: {
              id: 'k1',
              agentId: 'agent-a',
              organizationId: 'org-a',
              scopes: ['agent.use'],
            },
          };
        }
        return { ok: false, reason: 'not-found' };
      }),
    };
    const auth = buildApiAuth({ keyStore: resolver });
    const handler = auth(async (c: { req: { auth?: unknown } }) => ({
      body: { auth: c.req.auth },
    }));

    const ok = await handler(ctx('Bearer hipp0_ak_good'));
    expect(ok.body).toEqual({
      auth: {
        kind: 'agent-key',
        agentId: 'agent-a',
        organizationId: 'org-a',
        scopes: ['agent.use'],
        keyId: 'k1',
      },
    });

    const bad = await handler(ctx('Bearer hipp0_ak_bad'));
    expect(bad.status).toBe(401);
    // Bodies collapse to a generic error — no enumeration oracle.
    expect(bad.body).toEqual({ error: 'unauthorized' });
  });

  it('calls onAuthFailure with IP + keyPrefix on reject, never the raw bearer', async () => {
    const calls: Array<{ ip: string; keyPrefix: string | undefined; internalReason: string }> = [];
    const auth = buildApiAuth({
      staticToken: 'secret',
      onAuthFailure: (evt) => {
        calls.push(evt);
      },
    });
    const handler = auth(okHandler());
    const res = await handler({
      ...ctx('Bearer hipp0_ak_wrong123'),
      req: {
        headers: { authorization: 'Bearer hipp0_ak_wrong123' },
        socket: { remoteAddress: '10.0.0.5' },
      },
    });
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.ip).toBe('10.0.0.5');
    expect(calls[0]?.keyPrefix).toBe('hipp0_ak');
    expect(calls[0]?.internalReason).toBe('invalid-token');
    // Prefix must be 8 chars max (no full-bearer leak via audit hook).
    expect((calls[0]?.keyPrefix ?? '').length).toBeLessThanOrEqual(8);
  });

  it('combined mode — agent-key takes precedence; static token as fallback', async () => {
    const resolver: ApiKeyResolver = {
      verify: async (pt) =>
        pt === 'hipp0_ak_good'
          ? {
              ok: true,
              key: { id: 'k1', agentId: 'a', organizationId: 'o', scopes: ['x'] },
            }
          : { ok: false, reason: 'revoked' },
    };
    const auth = buildApiAuth({ staticToken: 'ops', keyStore: resolver });
    const handler = auth(async (c: { req: { auth?: { kind: string } } }) => ({
      body: { kind: c.req.auth?.kind },
    }));

    expect((await handler(ctx('Bearer ops'))).body).toEqual({ kind: 'static' });
    expect((await handler(ctx('Bearer hipp0_ak_good'))).body).toEqual({ kind: 'agent-key' });
    // Revoked key falls through to static (static token absent) → 401 (since value != 'ops').
    expect((await handler(ctx('Bearer hipp0_ak_bad'))).status).toBe(401);
  });

  it('rejects non-Bearer authorization headers', async () => {
    const auth = buildApiAuth({ staticToken: 'secret' });
    const handler = auth(okHandler());
    expect((await handler(ctx('Basic Zm9vOmJhcg=='))).status).toBe(401);
  });

  it('attaches auth context on static token matches (handlers can read it)', async () => {
    const auth = buildApiAuth({ staticToken: 'ops' });
    const handler = auth(async (c: { req: { auth?: unknown } }) => ({
      body: { auth: c.req.auth },
    }));
    const res = await handler(ctx('Bearer ops'));
    expect(res.body).toEqual({ auth: { kind: 'static' } });
  });
});
