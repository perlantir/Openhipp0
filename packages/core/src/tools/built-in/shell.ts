/**
 * Built-in shell tool: shell_execute.
 *
 * Uses the sandbox from ExecutionContext.sandbox. Shell output is capped at
 * maxOutputBytes to protect the agent's context window. Working directory must
 * fall under allowedPaths (enforced by assertPathAllowed).
 *
 * Docker mode auto-mounts all `allowedPaths` as read-only bind mounts. Writing
 * back must go through file_write (which goes through the path guard again).
 */

import { z } from 'zod';
import { runInSandbox } from '../sandbox.js';
import { assertPathAllowed } from '../path-guard.js';
import type { Tool } from '../types.js';

const shellExecuteParams = z.object({
  cmd: z.string().min(1).max(8192),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
  maxOutputBytes: z.number().int().positive().max(1_000_000).default(200_000),
});

export const shellExecuteTool: Tool<z.infer<typeof shellExecuteParams>> = {
  name: 'shell_execute',
  description:
    'Run a shell command under the configured sandbox (docker/native/none). Output truncated at maxOutputBytes.',
  permissions: ['shell.execute'],
  inputSchema: {
    type: 'object',
    required: ['cmd'],
    properties: {
      cmd: { type: 'string', description: 'Command to run, interpreted by /bin/sh.' },
      cwd: { type: 'string' },
      env: { type: 'object', additionalProperties: { type: 'string' } },
      maxOutputBytes: { type: 'integer', minimum: 1, maximum: 1_000_000, default: 200_000 },
    },
  },
  validator: shellExecuteParams,
  async execute(params, ctx) {
    let cwd = params.cwd;
    if (cwd) {
      cwd = assertPathAllowed(cwd, { allowedRoots: ctx.allowedPaths, tool: this.name });
    } else if (ctx.allowedPaths.length > 0) {
      cwd = ctx.allowedPaths[0];
    }

    const outcome = await runInSandbox(ctx.sandbox, params.cmd, {
      ...(cwd && { cwd }),
      ...(params.env && { env: params.env }),
      timeoutMs: ctx.timeoutMs,
      ...(ctx.signal && { signal: ctx.signal }),
      readOnlyMounts: ctx.sandbox === 'docker' ? [...ctx.allowedPaths] : undefined,
    });

    const combined = truncate(outcome.stdout + outcome.stderr, params.maxOutputBytes);
    const truncated = combined.length < outcome.stdout.length + outcome.stderr.length;

    return {
      ok: outcome.exitCode === 0 && !outcome.timedOut,
      output: combined,
      ...(outcome.timedOut && { errorCode: 'HIPP0_SHELL_TIMEOUT' }),
      ...(outcome.exitCode !== 0 && !outcome.timedOut && { errorCode: 'HIPP0_SHELL_NONZERO_EXIT' }),
      metadata: {
        exitCode: outcome.exitCode,
        timedOut: outcome.timedOut,
        mode: outcome.mode,
        truncated,
        stdoutBytes: outcome.stdout.length,
        stderrBytes: outcome.stderr.length,
      },
    };
  },
};

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n... (truncated, ${s.length - max} more bytes)`;
}
