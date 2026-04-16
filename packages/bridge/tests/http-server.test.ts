import { describe, it, expect, afterEach } from 'vitest';
import { Hipp0HttpServer } from '../src/index.js';

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
  });
});
