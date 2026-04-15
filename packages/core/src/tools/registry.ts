/**
 * ToolRegistry — canonical entry point for invoking tools.
 *
 * Always runs in this order:
 *   1. Lookup (404 → Hipp0ToolNotFoundError)
 *   2. Permission check (missing → Hipp0PermissionDeniedError)
 *   3. Runtime validation with tool.validator (invalid → Hipp0ValidationError)
 *   4. Timeout race against tool.execute (expired → Hipp0ToolTimeoutError)
 *   5. Audit hook (always fires)
 *
 * Never throws raw errors back to the agent loop — every failure becomes
 * a Hipp0ToolError (structured) that the agent can inspect and the audit
 * hook records.
 */

import {
  Hipp0PermissionDeniedError,
  Hipp0ToolError,
  Hipp0ToolNotFoundError,
  Hipp0ToolTimeoutError,
  Hipp0ValidationError,
  type AuditEntry,
  type ExecutionContext,
  type Permission,
  type Tool,
  type ToolResult,
} from './types.js';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    this.tools.set(tool.name, tool);
  }

  registerAll(tools: readonly Tool[]): void {
    for (const t of tools) this.register(t);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): string[] {
    return [...this.tools.keys()].sort();
  }

  /** Unregister a tool. Returns true if it existed. */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Invoke a tool by name. Always returns a ToolResult; on protocol failures
   * (unknown tool, permission, validation, timeout) the result has ok=false
   * with errorCode set. Throws only for unexpected bugs inside the execute
   * implementation itself (which the agent loop should treat as fatal).
   */
  async execute(name: string, rawParams: unknown, ctx: ExecutionContext): Promise<ToolResult> {
    const start = Date.now();

    // Capture fields we need for audit even when the tool call fails early.
    const audit = async (entry: Omit<AuditEntry, 'timestamp'>): Promise<void> => {
      try {
        await ctx.auditHook?.({ ...entry, timestamp: Date.now() });
      } catch {
        // Audit failure must not break tool execution. Swallow.
      }
    };

    // 1. Lookup
    const tool = this.tools.get(name);
    if (!tool) {
      const err = new Hipp0ToolNotFoundError(name);
      await audit({
        tool: name,
        params: rawParams,
        ok: false,
        errorCode: err.code,
        errorMessage: err.message,
        durationMs: Date.now() - start,
        agent: { id: ctx.agent.id, name: ctx.agent.name },
        projectId: ctx.projectId,
      });
      return toResult(err);
    }

    // 2. Permission check
    const missing = missingPermissions(tool.permissions, ctx.grantedPermissions);
    if (missing.length > 0) {
      const err = new Hipp0PermissionDeniedError(tool.name, missing);
      await audit({
        tool: name,
        params: rawParams,
        ok: false,
        errorCode: err.code,
        errorMessage: err.message,
        durationMs: Date.now() - start,
        agent: { id: ctx.agent.id, name: ctx.agent.name },
        projectId: ctx.projectId,
      });
      return toResult(err);
    }

    // 3. Validate
    const parsed = tool.validator.safeParse(rawParams);
    if (!parsed.success) {
      const err = new Hipp0ValidationError(tool.name, parsed.error.issues);
      await audit({
        tool: name,
        params: rawParams,
        ok: false,
        errorCode: err.code,
        errorMessage: err.message,
        durationMs: Date.now() - start,
        agent: { id: ctx.agent.id, name: ctx.agent.name },
        projectId: ctx.projectId,
      });
      return toResult(err, { issues: parsed.error.issues });
    }

    // 4. Execute with timeout
    let result: ToolResult;
    try {
      result = await withTimeout(
        tool.execute(parsed.data, ctx),
        ctx.timeoutMs,
        new Hipp0ToolTimeoutError(tool.name, ctx.timeoutMs),
      );
    } catch (err) {
      if (err instanceof Hipp0ToolError) {
        await audit({
          tool: name,
          params: parsed.data,
          ok: false,
          errorCode: err.code,
          errorMessage: err.message,
          durationMs: Date.now() - start,
          agent: { id: ctx.agent.id, name: ctx.agent.name },
          projectId: ctx.projectId,
        });
        return toResult(err);
      }
      // Unexpected — log to audit and rethrow so the agent loop sees it.
      const msg = err instanceof Error ? err.message : String(err);
      await audit({
        tool: name,
        params: parsed.data,
        ok: false,
        errorCode: 'HIPP0_TOOL_EXECUTE_THREW',
        errorMessage: msg,
        durationMs: Date.now() - start,
        agent: { id: ctx.agent.id, name: ctx.agent.name },
        projectId: ctx.projectId,
      });
      throw err;
    }

    // 5. Audit success
    await audit({
      tool: name,
      params: parsed.data,
      ok: result.ok,
      ...(result.errorCode && { errorCode: result.errorCode }),
      durationMs: Date.now() - start,
      agent: { id: ctx.agent.id, name: ctx.agent.name },
      projectId: ctx.projectId,
    });
    return result;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function missingPermissions(
  needed: readonly Permission[],
  granted: readonly Permission[],
): Permission[] {
  const have = new Set(granted);
  return needed.filter((p) => !have.has(p));
}

function toResult(err: Hipp0ToolError, metadata?: Record<string, unknown>): ToolResult {
  return {
    ok: false,
    output: err.message,
    errorCode: err.code,
    ...(metadata && { metadata }),
  };
}

/** Race a promise against a timeout. On timeout, rejects with `onTimeoutError`. */
async function withTimeout<T>(p: Promise<T>, timeoutMs: number, onTimeoutError: Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_res, rej) => {
        timer = setTimeout(() => rej(onTimeoutError), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
