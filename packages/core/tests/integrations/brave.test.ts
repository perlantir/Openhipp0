import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBraveSearchTool } from '../../src/integrations/brave/tools.js';
import type { ExecutionContext } from '../../src/tools/types.js';

const ctx: ExecutionContext = {
  sandbox: 'native',
  timeoutMs: 5_000,
  allowedPaths: [],
  allowedDomains: ['api.search.brave.com'],
  grantedPermissions: ['net.fetch'],
  agent: { id: 'a', name: 'A', role: 'r' },
  projectId: 'p',
};

const realFetch = globalThis.fetch;

beforeEach(() => {
  globalThis.fetch = vi.fn() as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe('brave_search tool', () => {
  it('returns HIPP0_BRAVE_NO_KEY when neither env nor config supplies a key', async () => {
    delete process.env['HIPP0_BRAVE_API_KEY'];
    const tool = createBraveSearchTool();
    const r = await tool.execute({ q: 'foo' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('HIPP0_BRAVE_NO_KEY');
  });

  it('sends the query + subscription token in headers', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response(JSON.stringify({ web: { results: [{ title: 'Hit', url: 'https://x.test' }] } }), {
        status: 200,
      }),
    );
    const tool = createBraveSearchTool({ apiKey: 'XYZ' });
    const r = await tool.execute({ q: 'openhipp0' }, ctx);
    expect(r.ok).toBe(true);
    const mock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const url = String(mock.mock.calls[0]?.[0] ?? '');
    const headers = (mock.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>;
    expect(url).toContain('q=openhipp0');
    expect(headers['X-Subscription-Token']).toBe('XYZ');
    expect(r.output).toContain('Hit');
  });

  it('returns ok:false with HIPP0_BRAVE_HTTP on 4xx/5xx', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    );
    const tool = createBraveSearchTool({ apiKey: 'k' });
    const r = await tool.execute({ q: 'foo' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('HIPP0_BRAVE_HTTP');
  });
});
