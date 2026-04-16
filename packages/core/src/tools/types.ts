/**
 * Tool interface + execution context + error hierarchy.
 *
 * Tools are provider-agnostic units of side effect. Each tool:
 *   1. Declares its required Permissions.
 *   2. Ships a JSON Schema for the LLM (inputSchema) + Zod validator for runtime checks.
 *   3. Returns a ToolResult — never throws to the LLM directly; errors are structured.
 *
 * The ToolRegistry enforces:
 *   - Permission check (tool.permissions ⊆ ctx.grantedPermissions)
 *   - Runtime input validation (Zod)
 *   - Timeout (from ctx.timeoutMs)
 *   - Audit hook (every call, success or failure)
 */

import type { z } from 'zod';
import { Hipp0Error } from '../llm/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Permissions (coarse-grained; fine-grained allow-lists live on ExecutionContext)
// ─────────────────────────────────────────────────────────────────────────────

export type Permission =
  | 'fs.read'
  | 'fs.write'
  | 'fs.list'
  | 'shell.execute'
  | 'net.fetch'
  | 'browser.use';

export const ALL_PERMISSIONS: readonly Permission[] = [
  'fs.read',
  'fs.write',
  'fs.list',
  'shell.execute',
  'net.fetch',
  'browser.use',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Execution context
// ─────────────────────────────────────────────────────────────────────────────

export type SandboxMode = 'docker' | 'native' | 'none';

export interface ExecutionContext {
  /** Default sandbox mode for shell.execute. Tools may override where safe. */
  sandbox: SandboxMode;
  /** Per-call timeout (ms). */
  timeoutMs: number;
  /** Absolute directories the tools may read/write (recursively). `~` is expanded. */
  allowedPaths: readonly string[];
  /** Hostnames (exact or `*.` suffix) the tools may fetch. */
  allowedDomains: readonly string[];
  /** Permissions granted to this invocation by the policy engine. */
  grantedPermissions: readonly Permission[];
  /** Agent identity for audit logging. */
  agent: { id: string; name: string; role: string };
  /** Project scope for audit logging. */
  projectId: string;
  /** Optional audit sink. Fires on every tool call (success or failure). */
  auditHook?: AuditHook;
  /** Optional abort signal propagated into tool execution. */
  signal?: AbortSignal;
}

export type AuditHook = (entry: AuditEntry) => void | Promise<void>;

export interface AuditEntry {
  tool: string;
  params: unknown;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  durationMs: number;
  agent: { id: string; name: string };
  projectId: string;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool + ToolResult
// ─────────────────────────────────────────────────────────────────────────────

export interface ToolResult {
  ok: boolean;
  /** Stringified output (stdout for shell, file contents for fs, body for net, etc.). */
  output: string;
  /** Machine-readable error code when ok=false. */
  errorCode?: string;
  /** Structured metadata (exit code, status, headers, etc.) */
  metadata?: Record<string, unknown>;
}

export interface Tool<P = unknown> {
  name: string;
  description: string;
  /** JSON Schema consumed by LLM tool-use APIs. */
  inputSchema: Record<string, unknown>;
  /**
   * Zod validator. Output type is `P`; input type is `unknown` because the
   * registry receives arbitrary JSON from the LLM. Defaults + transforms in
   * the schema are honored — the parsed value the tool sees will be of shape P.
   */
  validator: z.ZodType<P, z.ZodTypeDef, unknown>;
  /** Permissions required to invoke this tool. */
  permissions: readonly Permission[];
  /** Actual work. Must not throw plain errors; wrap in ToolResult.ok=false. */
  execute(params: P, ctx: ExecutionContext): Promise<ToolResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class Hipp0ToolError extends Hipp0Error {
  readonly tool: string;
  constructor(message: string, tool: string, code = 'HIPP0_TOOL_ERROR') {
    super(message, code);
    this.tool = tool;
  }
}

export class Hipp0ToolNotFoundError extends Hipp0ToolError {
  constructor(tool: string) {
    super(`Tool not found: "${tool}"`, tool, 'HIPP0_TOOL_NOT_FOUND');
  }
}

export class Hipp0PermissionDeniedError extends Hipp0ToolError {
  readonly missing: readonly Permission[];
  constructor(tool: string, missing: readonly Permission[]) {
    super(
      `Tool "${tool}" requires permissions not granted: ${missing.join(', ')}`,
      tool,
      'HIPP0_PERMISSION_DENIED',
    );
    this.missing = missing;
  }
}

export class Hipp0PathDeniedError extends Hipp0ToolError {
  readonly path: string;
  readonly reason: 'blocked' | 'outside_allowed' | 'traversal';
  constructor(tool: string, path: string, reason: 'blocked' | 'outside_allowed' | 'traversal') {
    super(`Path access denied for "${tool}" (${reason}): ${path}`, tool, 'HIPP0_PATH_DENIED');
    this.path = path;
    this.reason = reason;
  }
}

export class Hipp0DomainDeniedError extends Hipp0ToolError {
  readonly host: string;
  constructor(tool: string, host: string) {
    super(`Domain not in allowlist for "${tool}": ${host}`, tool, 'HIPP0_DOMAIN_DENIED');
    this.host = host;
  }
}

export class Hipp0ToolTimeoutError extends Hipp0ToolError {
  readonly timeoutMs: number;
  constructor(tool: string, timeoutMs: number) {
    super(`Tool "${tool}" timed out after ${timeoutMs}ms`, tool, 'HIPP0_TOOL_TIMEOUT');
    this.timeoutMs = timeoutMs;
  }
}

export class Hipp0ValidationError extends Hipp0ToolError {
  readonly issues: unknown;
  constructor(tool: string, issues: unknown) {
    super(`Invalid input to tool "${tool}"`, tool, 'HIPP0_VALIDATION_ERROR');
    this.issues = issues;
  }
}
