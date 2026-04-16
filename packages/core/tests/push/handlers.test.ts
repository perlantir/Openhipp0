import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryPushRegistry,
  PushSender,
  connectApprovalsToPush,
  notifyAutomationComplete,
  notifySecurityAlert,
  type ApprovalEmitter,
  type ApprovalEvent,
  type ExpoPushMessage,
  type ExpoPushTicket,
} from '../../src/push/index.js';

class FakeEmitter implements ApprovalEmitter {
  private handler: ((e: ApprovalEvent) => void) | undefined;
  onApprovalRequest(h: (e: ApprovalEvent) => void): void {
    this.handler = h;
  }
  fire(e: ApprovalEvent): void {
    this.handler?.(e);
  }
}

function sender(): { sender: PushSender; sent: ExpoPushMessage[]; flushed: Promise<void> } {
  const registry = new InMemoryPushRegistry();
  void registry.upsert({
    deviceId: 'a',
    pushToken: 'ExponentPushToken[a]',
    platform: 'ios',
    updatedAt: '2026-04-16T00:00:00Z',
  });
  const sent: ExpoPushMessage[] = [];
  let resolveFlush!: () => void;
  const flushed = new Promise<void>((r) => (resolveFlush = r));
  const transport = {
    async send(messages: readonly ExpoPushMessage[]): Promise<readonly ExpoPushTicket[]> {
      sent.push(...messages);
      resolveFlush();
      return messages.map(() => ({ status: 'ok' as const, id: 'x' }));
    },
  };
  return { sender: new PushSender({ registry, transport }), sent, flushed };
}

describe('connectApprovalsToPush', () => {
  it('translates approval events into urgent push fan-outs', async () => {
    const emitter = new FakeEmitter();
    const { sender: s, sent, flushed } = sender();
    connectApprovalsToPush(emitter, s);

    emitter.fire({
      id: 'req-1',
      agentId: 'agent-a',
      action: 'send_email',
      description: 'Send reply to jane@example.com',
      details: { to: 'jane@example.com' },
    });

    await flushed;
    expect(sent).toHaveLength(1);
    expect(sent[0]?.title).toBe('Approve: send_email');
    expect(sent[0]?.body).toBe('Send reply to jane@example.com');
    expect(sent[0]?.data).toMatchObject({
      kind: 'approval',
      refId: 'req-1',
      agentId: 'agent-a',
      to: 'jane@example.com',
    });
    expect(sent[0]?.priority).toBe('high');
  });

  it('never throws even if the sender transport fails', async () => {
    const emitter = new FakeEmitter();
    const registry = new InMemoryPushRegistry();
    await registry.upsert({
      deviceId: 'a',
      pushToken: 'ExponentPushToken[a]',
      platform: 'ios',
      updatedAt: '2026-04-16T00:00:00Z',
    });
    const transport = { send: vi.fn(async () => { throw new Error('boom'); }) };
    const s = new PushSender({ registry, transport });
    connectApprovalsToPush(emitter, s);

    expect(() => emitter.fire({ id: '1', agentId: 'a', action: 'act', description: 'd' })).not.toThrow();
  });
});

describe('notifyAutomationComplete', () => {
  it('success uses check emoji + default body', async () => {
    const { sender: s, sent } = sender();
    await notifyAutomationComplete(s, { taskId: 't1', taskName: 'Morning digest', status: 'success' });
    expect(sent[0]?.title).toBe('✓ Morning digest');
    expect(sent[0]?.body).toBe('Completed.');
    expect(sent[0]?.priority).toBe('normal');
  });

  it('failure uses warn emoji + urgent priority', async () => {
    const { sender: s, sent } = sender();
    await notifyAutomationComplete(s, {
      taskId: 't2',
      taskName: 'Price watch',
      status: 'failure',
      summary: 'Vendor page returned 500',
    });
    expect(sent[0]?.title).toBe('⚠ Price watch failed');
    expect(sent[0]?.body).toBe('Vendor page returned 500');
    expect(sent[0]?.priority).toBe('high');
  });
});

describe('notifySecurityAlert', () => {
  it('info severity uses normal priority', async () => {
    const { sender: s, sent } = sender();
    await notifySecurityAlert(s, { title: 'Login', description: 'from new device', severity: 'info' });
    expect(sent[0]?.priority).toBe('normal');
  });
  it('critical severity uses high priority', async () => {
    const { sender: s, sent } = sender();
    await notifySecurityAlert(s, {
      title: 'Canary tripped',
      description: 'Agent accessed fake credential',
      severity: 'critical',
    });
    expect(sent[0]?.priority).toBe('high');
    expect(sent[0]?.data).toMatchObject({ severity: 'critical' });
  });
});
