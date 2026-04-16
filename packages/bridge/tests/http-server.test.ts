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
});
