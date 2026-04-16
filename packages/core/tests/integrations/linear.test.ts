import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createLinearCreateIssueTool,
  createLinearListIssuesTool,
} from '../../src/integrations/linear/tools.js';
import type { ExecutionContext } from '../../src/tools/types.js';

const ctx: ExecutionContext = {
  sandbox: 'native',
  timeoutMs: 5_000,
  allowedPaths: [],
  allowedDomains: ['api.linear.app'],
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
  delete process.env['HIPP0_LINEAR_KEY'];
});

describe('linear_* tools', () => {
  it('list_issues: posts a GraphQL query', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ data: { viewer: { assignedIssues: { nodes: [] } } } }), {
        status: 200,
      }),
    );
    const tool = createLinearListIssuesTool({ apiKey: 'k' });
    const r = await tool.execute({ limit: 5 }, ctx);
    expect(r.ok).toBe(true);
    const init = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('POST');
    const body = JSON.parse(String(init.body)) as { query: string; variables: { first: number } };
    expect(body.query).toContain('assignedIssues');
    expect(body.variables.first).toBe(5);
    const headers = init.headers as Record<string, string>;
    expect(headers['authorization']).toBe('k');
  });

  it('create_issue: sends the issueCreate mutation', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({ data: { issueCreate: { success: true } } }), { status: 200 }),
    );
    const tool = createLinearCreateIssueTool({ apiKey: 'k' });
    const r = await tool.execute({ teamId: 't1', title: 'x' }, ctx);
    expect(r.ok).toBe(true);
    const body = JSON.parse(
      String(((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as RequestInit).body),
    ) as { query: string };
    expect(body.query).toContain('issueCreate');
  });

  it('surfaces a missing credential as HIPP0_LINEAR_ERR', async () => {
    const tool = createLinearListIssuesTool({});
    const r = await tool.execute({}, ctx);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('HIPP0_LINEAR_ERR');
  });
});
