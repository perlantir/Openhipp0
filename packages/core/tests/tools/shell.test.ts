import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { shellExecuteTool } from '../../src/tools/built-in/shell.js';
import type { ExecutionContext } from '../../src/tools/types.js';

let sandbox: string;

beforeEach(async () => {
  sandbox = await mkdtemp(join(tmpdir(), 'hipp0-sh-'));
});
afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

function ctx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    sandbox: 'native',
    timeoutMs: 5_000,
    allowedPaths: [sandbox],
    allowedDomains: [],
    grantedPermissions: ['shell.execute'],
    agent: { id: 'a1', name: 'lead', role: 'lead' },
    projectId: 'p1',
    ...overrides,
  };
}

describe('shell_execute (native mode)', () => {
  it('runs a simple command and captures stdout', async () => {
    const res = await shellExecuteTool.execute(
      { cmd: 'echo hipp0', maxOutputBytes: 100_000 },
      ctx(),
    );
    expect(res.ok).toBe(true);
    expect(res.output).toContain('hipp0');
    expect(res.metadata?.exitCode).toBe(0);
    expect(res.metadata?.mode).toBe('native');
  });

  it('reports non-zero exit as errorCode', async () => {
    const res = await shellExecuteTool.execute({ cmd: 'exit 42', maxOutputBytes: 100_000 }, ctx());
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('HIPP0_SHELL_NONZERO_EXIT');
    expect(res.metadata?.exitCode).toBe(42);
  });

  it('times out and reports HIPP0_SHELL_TIMEOUT', async () => {
    const res = await shellExecuteTool.execute(
      { cmd: 'sleep 5', maxOutputBytes: 100_000 },
      ctx({ timeoutMs: 100 }),
    );
    expect(res.ok).toBe(false);
    expect(res.errorCode).toBe('HIPP0_SHELL_TIMEOUT');
    expect(res.metadata?.timedOut).toBe(true);
  });

  it('truncates oversized output', async () => {
    // Build a string comfortably larger than the limit.
    const res = await shellExecuteTool.execute(
      { cmd: `yes x | head -c 5000`, maxOutputBytes: 500 },
      ctx(),
    );
    expect(res.ok).toBe(true);
    expect(res.output.length).toBeLessThan(5000);
    expect(res.metadata?.truncated).toBe(true);
  });

  it('rejects cwd outside allowedPaths', async () => {
    await expect(
      shellExecuteTool.execute({ cmd: 'pwd', cwd: '/etc', maxOutputBytes: 100_000 }, ctx()),
    ).rejects.toThrow(/Path access denied/);
  });
});
