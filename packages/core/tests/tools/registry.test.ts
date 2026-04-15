import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ToolRegistry } from '../../src/tools/registry.js';
import type {
  AuditEntry,
  ExecutionContext,
  Permission,
  Tool,
  ToolResult,
} from '../../src/tools/types.js';

function makeCtx(
  opts: Partial<ExecutionContext> & { audit?: AuditEntry[] } = {},
): ExecutionContext {
  const audit = opts.audit ?? [];
  return {
    sandbox: 'native',
    timeoutMs: 5_000,
    allowedPaths: [],
    allowedDomains: [],
    grantedPermissions: opts.grantedPermissions ?? (['fs.read', 'fs.write'] as Permission[]),
    agent: { id: 'a1', name: 'lead', role: 'lead' },
    projectId: 'proj-1',
    auditHook: (entry) => {
      audit.push(entry);
    },
    ...opts,
  } as ExecutionContext;
}

function echoTool(name = 'echo'): Tool<{ msg: string }> {
  return {
    name,
    description: 'Echoes a message',
    inputSchema: { type: 'object', required: ['msg'], properties: { msg: { type: 'string' } } },
    validator: z.object({ msg: z.string() }),
    permissions: ['fs.read'],
    async execute(params) {
      return { ok: true, output: params.msg };
    },
  };
}

describe('ToolRegistry', () => {
  it('registers and lists tools', () => {
    const reg = new ToolRegistry();
    reg.register(echoTool('echo'));
    reg.register(echoTool('echo2'));
    expect(reg.list()).toEqual(['echo', 'echo2']);
    expect(reg.get('echo')?.name).toBe('echo');
  });

  it('throws on duplicate registration', () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());
    expect(() => reg.register(echoTool())).toThrow(/already registered/);
  });

  it('unregister works', () => {
    const reg = new ToolRegistry();
    reg.register(echoTool('t'));
    expect(reg.unregister('t')).toBe(true);
    expect(reg.unregister('t')).toBe(false);
    expect(reg.list()).toHaveLength(0);
  });

  it('returns HIPP0_TOOL_NOT_FOUND for unknown tool', async () => {
    const reg = new ToolRegistry();
    const audit: AuditEntry[] = [];
    const res = await reg.execute('nope', {}, makeCtx({ audit }));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('HIPP0_TOOL_NOT_FOUND');
    expect(audit).toHaveLength(1);
    expect(audit[0]!.ok).toBe(false);
  });

  it('blocks on missing permission and records audit', async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());
    const audit: AuditEntry[] = [];
    const res = await reg.execute(
      'echo',
      { msg: 'hi' },
      makeCtx({ grantedPermissions: [], audit }),
    );
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('HIPP0_PERMISSION_DENIED');
    expect(audit[0]!.errorCode).toBe('HIPP0_PERMISSION_DENIED');
  });

  it('validates params with Zod and returns HIPP0_VALIDATION_ERROR on bad input', async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());
    const res = await reg.execute('echo', { wrong: 'shape' }, makeCtx());
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('HIPP0_VALIDATION_ERROR');
    expect(res.metadata?.issues).toBeDefined();
  });

  it('executes happy path and records success', async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());
    const audit: AuditEntry[] = [];
    const res = await reg.execute('echo', { msg: 'hello' }, makeCtx({ audit }));
    expect(res.ok).toBe(true);
    expect(res.output).toBe('hello');
    expect(audit[0]!.ok).toBe(true);
    expect(audit[0]!.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('times out long-running tools', async () => {
    const reg = new ToolRegistry();
    const slow: Tool<object> = {
      name: 'slow',
      description: 's',
      inputSchema: { type: 'object' },
      validator: z.object({}),
      permissions: [],
      async execute(): Promise<ToolResult> {
        await new Promise((r) => setTimeout(r, 500));
        return { ok: true, output: 'never' };
      },
    };
    reg.register(slow);
    const res = await reg.execute('slow', {}, makeCtx({ timeoutMs: 20 }));
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('HIPP0_TOOL_TIMEOUT');
  });

  it('audit hook failure does not break the call', async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());
    const ctx = makeCtx({
      auditHook: () => {
        throw new Error('audit sink down');
      },
    });
    const res = await reg.execute('echo', { msg: 'ok' }, ctx);
    expect(res.ok).toBe(true); // tool still succeeds
  });

  it('unexpected throws from tool.execute propagate (are not swallowed)', async () => {
    const reg = new ToolRegistry();
    const buggy: Tool<object> = {
      name: 'buggy',
      description: 'b',
      inputSchema: { type: 'object' },
      validator: z.object({}),
      permissions: [],
      async execute() {
        throw new Error('implementation bug');
      },
    };
    reg.register(buggy);
    await expect(reg.execute('buggy', {}, makeCtx())).rejects.toThrow('implementation bug');
  });

  it('does not call auditHook multiple times on the same invocation', async () => {
    const reg = new ToolRegistry();
    reg.register(echoTool());
    const hook = vi.fn();
    await reg.execute('echo', { msg: 'x' }, makeCtx({ auditHook: hook, audit: [] }));
    expect(hook).toHaveBeenCalledOnce();
  });
});
