/**
 * Security / policy engine types.
 *
 * An AgentPolicy defines what an agent is allowed to do: which permissions
 * are granted, which paths/domains are allowed, whether high-stakes actions
 * need human approval, etc.
 *
 * Templates (strict / moderate / permissive) provide sensible defaults;
 * callers can customize per-agent or per-project.
 */

import { z } from 'zod';

export type PolicyLevel = 'strict' | 'moderate' | 'permissive';

export const AgentPolicySchema = z.object({
  level: z.enum(['strict', 'moderate', 'permissive']).default('moderate'),
  /** Granted permissions (subset of ALL_PERMISSIONS from tools/types.ts). */
  permissions: z.array(z.string()).default([]),
  /** Filesystem paths the agent may read. Supports glob patterns. */
  allowedPaths: z.array(z.string()).default(['./**']),
  /** Network domains the agent may fetch. */
  allowedDomains: z.array(z.string()).default([]),
  /** Paths that are ALWAYS blocked (regardless of allowedPaths). */
  blockedPaths: z
    .array(z.string())
    .default(['~/.ssh/**', '~/.aws/**', '~/.gnupg/**', '~/.hipp0/secrets/**']),
  /** Action categories that require human approval before execution. */
  requireApproval: z.array(z.string()).default([]),
  /** Maximum concurrent tool calls. 0 = unlimited. */
  maxConcurrentTools: z.number().int().nonnegative().default(5),
  /** Per-tool-call timeout in ms. Default 30_000. */
  toolTimeoutMs: z.number().positive().default(30_000),
});

export type AgentPolicy = z.infer<typeof AgentPolicySchema>;

export type ApprovalDecision = 'approved' | 'denied' | 'timeout';

export interface ApprovalRequest {
  /** Unique id for this request (used to correlate response). */
  id: string;
  agentId: string;
  action: string;
  description: string;
  /** Structured detail for the approval UI. */
  details: Record<string, unknown>;
  requestedAt: number;
  timeoutMs: number;
}

export interface ApprovalResponse {
  requestId: string;
  decision: ApprovalDecision;
  /** If overridden (approved despite the policy), the justification. */
  justification?: string;
  decidedAt: number;
}

export class Hipp0PolicyError extends Error {
  readonly code: string;
  constructor(message: string, code = 'HIPP0_POLICY_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class Hipp0ApprovalDeniedError extends Hipp0PolicyError {
  readonly requestId: string;
  constructor(requestId: string) {
    super(`Approval denied for request ${requestId}`, 'HIPP0_APPROVAL_DENIED');
    this.requestId = requestId;
  }
}

export class Hipp0ApprovalTimeoutError extends Hipp0PolicyError {
  readonly requestId: string;
  constructor(requestId: string, timeoutMs: number) {
    super(`Approval request ${requestId} timed out after ${timeoutMs}ms`, 'HIPP0_APPROVAL_TIMEOUT');
    this.requestId = requestId;
  }
}
