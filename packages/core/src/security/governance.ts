/**
 * Execution governance — manages the approval flow for high-stakes actions.
 *
 * The pattern:
 *   1. PolicyEnforcer (policy.ts) returns `deniedBy: 'approval_required'`.
 *   2. Caller invokes `requestApproval(...)` here; governance emits the
 *      request to a configured approval handler (bridge button, CLI prompt,
 *      dashboard modal).
 *   3. The handler invokes `resolveApproval(id, decision)`.
 *   4. Governance returns the decision to the caller.
 *
 * The handler is injected — governance owns no I/O. This avoids coupling to
 * any specific bridge or UI.
 */

import {
  Hipp0ApprovalTimeoutError,
  type ApprovalDecision,
  type ApprovalRequest,
  type ApprovalResponse,
} from './types.js';

export type ApprovalHandler = (req: ApprovalRequest) => void;

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (resp: ApprovalResponse) => void;
  timer: ReturnType<typeof setTimeout>;
}

let nextId = 0;

export class GovernanceEngine {
  private readonly pending = new Map<string, PendingApproval>();
  private handler: ApprovalHandler | undefined;
  /** Audit log — callers can read this to persist to the auditLog table. */
  readonly auditLog: ApprovalResponse[] = [];

  /** Set the handler that presents approval requests to a human. */
  onApprovalRequest(handler: ApprovalHandler): void {
    this.handler = handler;
  }

  /**
   * Request approval. Returns a promise that resolves when the handler calls
   * resolveApproval(), or rejects on timeout/deny.
   */
  async requestApproval(opts: {
    agentId: string;
    action: string;
    description: string;
    details?: Record<string, unknown>;
    timeoutMs?: number;
  }): Promise<ApprovalResponse> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const id = `approval-${++nextId}`;
    const request: ApprovalRequest = {
      id,
      agentId: opts.agentId,
      action: opts.action,
      description: opts.description,
      details: opts.details ?? {},
      requestedAt: Date.now(),
      timeoutMs,
    };
    return new Promise<ApprovalResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const resp: ApprovalResponse = {
          requestId: id,
          decision: 'timeout',
          decidedAt: Date.now(),
        };
        this.auditLog.push(resp);
        reject(new Hipp0ApprovalTimeoutError(id, timeoutMs));
      }, timeoutMs);

      this.pending.set(id, { request, resolve, timer });
      if (this.handler) this.handler(request);
    });
  }

  /** Called by the approval UI to submit a decision. */
  resolveApproval(id: string, decision: ApprovalDecision, justification?: string): void {
    const entry = this.pending.get(id);
    if (!entry) return; // Already timed out or resolved.
    clearTimeout(entry.timer);
    this.pending.delete(id);
    const resp: ApprovalResponse = {
      requestId: id,
      decision,
      ...(justification ? { justification } : {}),
      decidedAt: Date.now(),
    };
    this.auditLog.push(resp);
    if (decision === 'denied') {
      // Resolve with the response anyway — caller checks decision.
      entry.resolve(resp);
      return;
    }
    entry.resolve(resp);
  }

  /** Count of in-flight approval requests. */
  pendingCount(): number {
    return this.pending.size;
  }

  /** Discard all pending approvals (e.g. on shutdown). */
  clear(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
  }
}
