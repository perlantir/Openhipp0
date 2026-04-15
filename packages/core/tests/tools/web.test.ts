import { describe, expect, it, vi } from 'vitest';
import { createWebFetchTool } from '../../src/tools/built-in/web.js';
import { Hipp0DomainDeniedError } from '../../src/tools/types.js';
import type { ExecutionContext } from '../../src/tools/types.js';

function ctx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    sandbox: 'native',
    timeoutMs: 5_000,
    allowedPaths: [],
    allowedDomains: ['api.example.com', '*.trusted.io'],
    grantedPermissions: ['net.fetch'],
    agent: { id: 'a1', name: 'lead', role: 'lead' },
    projectId: 'p1',
    ...overrides,
  };
}

function mockFetch(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return vi.fn(async () => {
    return new Response(body, {
      status: init.status ?? 200,
      headers: init.headers ?? { 'content-type': 'text/plain' },
    });
  });
}

describe('web_fetch', () => {
  it('allows a host in allowedDomains (exact match)', async () => {
    const fetchFn = mockFetch('OK');
    const tool = createWebFetchTool({ fetchFn, minIntervalMsPerHost: 0 });
    const res = await tool.execute(
      {
        url: 'https://api.example.com/v1/ping',
        method: 'GET',
        maxBytes: 2_000_000,
        allowHttp: false,
      },
      ctx(),
    );
    expect(res.ok).toBe(true);
    expect(res.output).toBe('OK');
    expect(res.metadata?.status).toBe(200);
  });

  it('allows subdomains via *.suffix wildcard', async () => {
    const fetchFn = mockFetch('OK');
    const tool = createWebFetchTool({ fetchFn, minIntervalMsPerHost: 0 });
    const res = await tool.execute(
      {
        url: 'https://v2.trusted.io/x',
        method: 'GET',
        maxBytes: 2_000_000,
        allowHttp: false,
      },
      ctx(),
    );
    expect(res.ok).toBe(true);
  });

  it('throws Hipp0DomainDeniedError for non-allowed host', async () => {
    const fetchFn = mockFetch('OK');
    const tool = createWebFetchTool({ fetchFn, minIntervalMsPerHost: 0 });
    await expect(
      tool.execute(
        {
          url: 'https://evil.com/steal',
          method: 'GET',
          maxBytes: 2_000_000,
          allowHttp: false,
        },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(Hipp0DomainDeniedError);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('rejects http:// unless allowHttp=true', async () => {
    const fetchFn = mockFetch('OK');
    const tool = createWebFetchTool({ fetchFn, minIntervalMsPerHost: 0 });
    const res = await tool.execute(
      {
        url: 'http://api.example.com/x',
        method: 'GET',
        maxBytes: 2_000_000,
        allowHttp: false,
      },
      ctx(),
    );
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('HIPP0_SCHEME_DENIED');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('accepts http:// when allowHttp=true', async () => {
    const fetchFn = mockFetch('OK');
    const tool = createWebFetchTool({ fetchFn, minIntervalMsPerHost: 0 });
    const res = await tool.execute(
      {
        url: 'http://api.example.com/x',
        method: 'GET',
        maxBytes: 2_000_000,
        allowHttp: true,
      },
      ctx(),
    );
    expect(res.ok).toBe(true);
  });

  it('enforces per-host rate limiting', async () => {
    const fetchFn = mockFetch('OK');
    const tool = createWebFetchTool({ fetchFn, minIntervalMsPerHost: 200 });
    const start = Date.now();
    await tool.execute(
      { url: 'https://api.example.com/a', method: 'GET', maxBytes: 100_000, allowHttp: false },
      ctx(),
    );
    await tool.execute(
      { url: 'https://api.example.com/b', method: 'GET', maxBytes: 100_000, allowHttp: false },
      ctx(),
    );
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(180); // ~200ms interval, small margin
  });

  it('returns ok=false on HTTP error status', async () => {
    const fetchFn = mockFetch('not found', { status: 404 });
    const tool = createWebFetchTool({ fetchFn, minIntervalMsPerHost: 0 });
    const res = await tool.execute(
      { url: 'https://api.example.com/x', method: 'GET', maxBytes: 100_000, allowHttp: false },
      ctx(),
    );
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('HIPP0_FETCH_404');
    expect(res.metadata?.status).toBe(404);
  });

  it('wraps network errors with HIPP0_FETCH_NETWORK', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const tool = createWebFetchTool({ fetchFn, minIntervalMsPerHost: 0 });
    const res = await tool.execute(
      { url: 'https://api.example.com/x', method: 'GET', maxBytes: 100_000, allowHttp: false },
      ctx(),
    );
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('HIPP0_FETCH_NETWORK');
  });
});
