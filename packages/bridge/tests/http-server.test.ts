import { describe, it, expect, afterEach } from 'vitest';
import { Hipp0HttpServer, createRateLimiter } from '../src/index.js';

let svr: Hipp0HttpServer | undefined;

afterEach(async () => {
  await svr?.stop();
  svr = undefined;
});

async function fetchJson(
  port: number,
  path: string,
): Promise<{ status: number; body: unknown }> {
  const resp = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await resp.json();
  return { status: resp.status, body };
}

describe('Hipp0HttpServer', () => {
  it('returns a healthy default when no probe is configured', async () => {
    svr = new Hipp0HttpServer({ port: 0 });
    const { port } = await svr.start();
    const { status, body } = await fetchJson(port, '/health');
    expect(status).toBe(200);
    expect(body).toMatchObject({ status: 'ok' });
  });

  it('invokes the injected probe', async () => {
    svr = new Hipp0HttpServer({
      port: 0,
      healthProbe: () => ({ status: 'warn', checks: [{ name: 'mock', status: 'warn' }] }),
    });
    const { port } = await svr.start();
    const { body } = await fetchJson(port, '/health');
    expect(body).toMatchObject({ status: 'warn' });
  });

  it('dispatches additional route handlers', async () => {
    svr = new Hipp0HttpServer({
      port: 0,
      routes: { 'GET /version': () => ({ version: '0.0.0' }) },
    });
    const { port } = await svr.start();
    const { status, body } = await fetchJson(port, '/version');
    expect(status).toBe(200);
    expect(body).toEqual({ version: '0.0.0' });
  });

  it('returns 404 JSON for unknown paths', async () => {
    svr = new Hipp0HttpServer({ port: 0 });
    const { port } = await svr.start();
    const { status, body } = await fetchJson(port, '/nope');
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: 'not found' });
  });

  it('returns 503 if the probe throws', async () => {
    svr = new Hipp0HttpServer({
      port: 0,
      healthProbe: () => {
        throw new Error('boom');
      },
    });
    const { port } = await svr.start();
    const { status, body } = await fetchJson(port, '/health');
    expect(status).toBe(503);
    expect(body).toMatchObject({ status: 'fail' });
  });

  // ─── Pattern-match routeTable (Phase 19 addition) ────────────────────────

  it('routeTable matches :param placeholders', async () => {
    svr = new Hipp0HttpServer({
      port: 0,
      routeTable: [
        {
          method: 'GET',
          path: '/api/items/:id',
          handler(ctx) {
            return { body: { id: ctx.params['id'] } };
          },
        },
      ],
    });
    const { port } = await svr.start();
    const { status, body } = await fetchJson(port, '/api/items/abc-123');
    expect(status).toBe(200);
    expect(body).toEqual({ id: 'abc-123' });
  });

  it('routeTable parses query strings', async () => {
    svr = new Hipp0HttpServer({
      port: 0,
      routeTable: [
        {
          method: 'GET',
          path: '/q',
          handler: (ctx) => ({ body: ctx.query }),
        },
      ],
    });
    const { port } = await svr.start();
    const { body } = await fetchJson(port, '/q?a=1&b=two');
    expect(body).toEqual({ a: '1', b: 'two' });
  });

  it('routeTable forwards JSON body on POST', async () => {
    svr = new Hipp0HttpServer({
      port: 0,
      routeTable: [
        {
          method: 'POST',
          path: '/echo',
          handler: (ctx) => ({ status: 201, body: ctx.body }),
        },
      ],
    });
    const { port } = await svr.start();
    const resp = await fetch(`http://127.0.0.1:${port}/echo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hi: 'there' }),
    });
    expect(resp.status).toBe(201);
    expect(await resp.json()).toEqual({ hi: 'there' });
  });

  it('routeTable returns 413 when body exceeds maxBodyBytes', async () => {
    svr = new Hipp0HttpServer({
      port: 0,
      maxBodyBytes: 10,
      routeTable: [
        {
          method: 'POST',
          path: '/big',
          handler: (ctx) => ({ body: ctx.body }),
        },
      ],
    });
    const { port } = await svr.start();
    const resp = await fetch(`http://127.0.0.1:${port}/big`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ k: 'x'.repeat(100) }),
    });
    expect(resp.status).toBe(413);
  });

  it('routeTable returns 400 on malformed JSON', async () => {
    svr = new Hipp0HttpServer({
      port: 0,
      routeTable: [
        { method: 'POST', path: '/bad', handler: () => ({ body: 'ok' }) },
      ],
    });
    const { port } = await svr.start();
    const resp = await fetch(`http://127.0.0.1:${port}/bad`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    });
    expect(resp.status).toBe(400);
    const body = (await resp.json()) as { error: string };
    // Opaque — no parser position leak.
    expect(body.error).toBe('invalid JSON body');
    expect(body.error).not.toMatch(/position|column|line/i);
  });

  // ─── Phase 3-H1 hardening ──────────────────────────────────────────────

  it('sets security headers on every response', async () => {
    svr = new Hipp0HttpServer({ port: 0 });
    const { port } = await svr.start();
    const resp = await fetch(`http://127.0.0.1:${port}/health`);
    expect(resp.headers.get('x-content-type-options')).toBe('nosniff');
    expect(resp.headers.get('x-frame-options')).toBe('DENY');
    expect(resp.headers.get('referrer-policy')).toBe('no-referrer');
    expect(resp.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(resp.headers.get('strict-transport-security')).toContain('max-age');
  });

  it('assigns a correlation id (x-request-id) per response', async () => {
    svr = new Hipp0HttpServer({ port: 0 });
    const { port } = await svr.start();
    const a = await fetch(`http://127.0.0.1:${port}/health`);
    const b = await fetch(`http://127.0.0.1:${port}/health`);
    const ra = a.headers.get('x-request-id');
    const rb = b.headers.get('x-request-id');
    expect(ra).toMatch(/^[0-9a-f-]{36}$/);
    expect(rb).toMatch(/^[0-9a-f-]{36}$/);
    expect(ra).not.toBe(rb);
  });

  it('returns opaque 500 with correlation id when a handler throws', async () => {
    const errors: unknown[] = [];
    svr = new Hipp0HttpServer({
      port: 0,
      routeTable: [
        {
          method: 'GET',
          path: '/explode',
          handler: () => {
            throw new Error('SECRET_DB_ERROR: FOREIGN KEY constraint failed on users.id = 42');
          },
        },
      ],
      onError: (err) => {
        errors.push(err);
      },
    });
    const { port } = await svr.start();
    const resp = await fetch(`http://127.0.0.1:${port}/explode`);
    expect(resp.status).toBe(500);
    const body = (await resp.json()) as { error: string; ref: string };
    expect(body.error).toBe('internal error');
    expect(body.ref).toMatch(/^[0-9a-f-]{36}$/);
    // The detailed error MUST NOT reach the client.
    expect(JSON.stringify(body)).not.toMatch(/FOREIGN|SECRET|users\.id/);
    // But it MUST be logged internally.
    expect(errors).toHaveLength(1);
  });

  it('handles OPTIONS preflight with 204 + CORS headers when origin allowed', async () => {
    svr = new Hipp0HttpServer({ port: 0, allowedOrigins: ['http://127.0.0.1:5173'] });
    const { port } = await svr.start();
    const resp = await fetch(`http://127.0.0.1:${port}/any-path`, {
      method: 'OPTIONS',
      headers: { origin: 'http://127.0.0.1:5173', 'access-control-request-method': 'GET' },
    });
    expect(resp.status).toBe(204);
    expect(resp.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:5173');
    expect(resp.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('handles OPTIONS preflight with 204 but NO ACAO when origin not allowed', async () => {
    svr = new Hipp0HttpServer({ port: 0, allowedOrigins: ['http://127.0.0.1:5173'] });
    const { port } = await svr.start();
    const resp = await fetch(`http://127.0.0.1:${port}/x`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example' },
    });
    expect(resp.status).toBe(204);
    expect(resp.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('HEAD request returns headers but no body', async () => {
    svr = new Hipp0HttpServer({ port: 0 });
    const { port } = await svr.start();
    const resp = await fetch(`http://127.0.0.1:${port}/health`, { method: 'HEAD' });
    expect(resp.status).toBe(200);
    expect(await resp.text()).toBe('');
  });

  it('rate limiter returns 429 after capacity is exhausted', async () => {
    const t = 0;
    const limiter = createRateLimiter({ capacity: 3, windowMs: 60_000, now: () => t });
    svr = new Hipp0HttpServer({
      port: 0,
      preRouteMiddlewares: [limiter],
      routeTable: [{ method: 'GET', path: '/hit', handler: () => ({ body: 'ok' }) }],
    });
    const { port } = await svr.start();
    // First 3 pass…
    for (let i = 0; i < 3; i++) {
      const r = await fetch(`http://127.0.0.1:${port}/hit`);
      expect(r.status).toBe(200);
    }
    // 4th should 429.
    const blocked = await fetch(`http://127.0.0.1:${port}/hit`);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).not.toBeNull();
    // /health is exempt by default.
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    expect(health.status).toBe(200);
  });

  it('rate limiter refills tokens over the window', () => {
    let t = 0;
    const limiter = createRateLimiter({ capacity: 2, windowMs: 1_000, now: () => t });
    const req = { socket: { remoteAddress: '1.2.3.4' }, headers: {} };
    // Burn both tokens.
    expect(limiter({ req: req as never, method: 'GET', pathname: '/x', requestId: 'a' })).toBeUndefined();
    expect(limiter({ req: req as never, method: 'GET', pathname: '/x', requestId: 'b' })).toBeUndefined();
    const blocked = limiter({ req: req as never, method: 'GET', pathname: '/x', requestId: 'c' });
    expect((blocked as { status: number }).status).toBe(429);
    // Advance half the window — should have ~1 token.
    t = 500;
    expect(limiter({ req: req as never, method: 'GET', pathname: '/x', requestId: 'd' })).toBeUndefined();
  });
});
