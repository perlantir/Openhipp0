import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createGithubCreateIssueTool,
  createGithubListIssuesTool,
  createGithubSearchReposTool,
} from '../../src/integrations/github/tools.js';
import type { ExecutionContext } from '../../src/tools/types.js';

const ctx: ExecutionContext = {
  sandbox: 'native',
  timeoutMs: 5_000,
  allowedPaths: [],
  allowedDomains: ['api.github.com'],
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
  delete process.env['HIPP0_GITHUB_TOKEN'];
});

describe('github_* tools', () => {
  it('search: sends bearer auth + encodes the query', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ items: [] }), { status: 200 }),
    );
    const tool = createGithubSearchReposTool({ token: 'ghp_x' });
    const r = await tool.execute({ q: 'hipp0 memory' }, ctx);
    expect(r.ok).toBe(true);
    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call?.[0])).toContain('search/repositories?q=hipp0%20memory');
    const headers = (call?.[1] as RequestInit).headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer ghp_x');
  });

  it('list_issues: honors the state filter', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('[]', { status: 200 }),
    );
    const tool = createGithubListIssuesTool({ token: 't' });
    await tool.execute({ owner: 'o', repo: 'r', state: 'closed' }, ctx);
    const url = String((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] ?? '');
    expect(url).toContain('/repos/o/r/issues?state=closed');
  });

  it('create_issue: POSTs with the right JSON body', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('{}', { status: 201 }),
    );
    const tool = createGithubCreateIssueTool({ token: 't' });
    const r = await tool.execute(
      { owner: 'o', repo: 'r', title: 'bug', body: 'oops', labels: ['bug'] },
      ctx,
    );
    expect(r.ok).toBe(true);
    const init = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as { title: string; labels: string[] };
    expect(body.title).toBe('bug');
    expect(body.labels).toEqual(['bug']);
  });

  it('falls back to HIPP0_GITHUB_TOKEN env when config omits it', async () => {
    process.env['HIPP0_GITHUB_TOKEN'] = 'env-token';
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    const tool = createGithubSearchReposTool();
    await tool.execute({ q: 'x' }, ctx);
    const headers = ((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit)
      .headers as Headers;
    expect(headers.get('authorization')).toBe('Bearer env-token');
  });

  it('returns HIPP0_GITHUB_NO_TOKEN when no token is available', async () => {
    const tool = createGithubSearchReposTool();
    const r = await tool.execute({ q: 'x' }, ctx);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('HIPP0_GITHUB_NO_TOKEN');
  });
});
