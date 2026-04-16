import { afterEach, describe, expect, it } from 'vitest';
import {
  GovernanceEngine,
  Hipp0ApprovalTimeoutError,
  type ApprovalRequest,
} from '../../src/security/index.js';

describe('GovernanceEngine', () => {
  let engine: GovernanceEngine;

  afterEach(() => {
    engine?.clear();
  });

  it('requestApproval + resolveApproval happy path', async () => {
    engine = new GovernanceEngine();
    engine.onApprovalRequest((req) => {
      // Simulate user clicking "approve" immediately.
      engine.resolveApproval(req.id, 'approved');
    });
    const resp = await engine.requestApproval({
      agentId: 'a1',
      action: 'shell.execute',
      description: 'run npm test',
    });
    expect(resp.decision).toBe('approved');
    expect(engine.auditLog).toHaveLength(1);
  });

  it('denied approval resolves with decision=denied', async () => {
    engine = new GovernanceEngine();
    engine.onApprovalRequest((req) => {
      engine.resolveApproval(req.id, 'denied');
    });
    const resp = await engine.requestApproval({
      agentId: 'a1',
      action: 'fs.write',
      description: 'overwrite config',
    });
    expect(resp.decision).toBe('denied');
  });

  it('approval with justification is recorded in audit log', async () => {
    engine = new GovernanceEngine();
    engine.onApprovalRequest((req) => {
      engine.resolveApproval(req.id, 'approved', 'emergency fix');
    });
    await engine.requestApproval({
      agentId: 'a1',
      action: 'shell.execute',
      description: 'deploy hotfix',
    });
    expect(engine.auditLog[0]!.justification).toBe('emergency fix');
  });

  it('times out and rejects with Hipp0ApprovalTimeoutError', async () => {
    engine = new GovernanceEngine();
    // No handler — nobody resolves.
    await expect(
      engine.requestApproval({
        agentId: 'a1',
        action: 'shell.execute',
        description: 'x',
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(Hipp0ApprovalTimeoutError);
    expect(engine.auditLog).toHaveLength(1);
    expect(engine.auditLog[0]!.decision).toBe('timeout');
  });

  it('pendingCount tracks in-flight requests', async () => {
    engine = new GovernanceEngine();
    const captured: ApprovalRequest[] = [];
    engine.onApprovalRequest((req) => captured.push(req));

    const p1 = engine.requestApproval({
      agentId: 'a1',
      action: 'x',
      description: 'x',
      timeoutMs: 5000,
    });
    expect(engine.pendingCount()).toBe(1);

    engine.resolveApproval(captured[0]!.id, 'approved');
    await p1;
    expect(engine.pendingCount()).toBe(0);
  });

  it('clear() cancels pending approvals without leaking timers', () => {
    engine = new GovernanceEngine();
    void engine.requestApproval({
      agentId: 'a1',
      action: 'x',
      description: 'x',
      timeoutMs: 60_000,
    });
    expect(engine.pendingCount()).toBe(1);
    engine.clear();
    expect(engine.pendingCount()).toBe(0);
  });

  it('resolveApproval on already-resolved id is a no-op', async () => {
    engine = new GovernanceEngine();
    engine.onApprovalRequest((req) => {
      engine.resolveApproval(req.id, 'approved');
      engine.resolveApproval(req.id, 'denied'); // duplicate — no-op
    });
    const resp = await engine.requestApproval({
      agentId: 'a1',
      action: 'x',
      description: 'x',
    });
    expect(resp.decision).toBe('approved');
    expect(engine.auditLog).toHaveLength(1);
  });
});
