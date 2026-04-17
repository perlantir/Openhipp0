import { describe, expect, it, vi } from 'vitest';

import type { streaming } from '@openhipp0/core';

import { ApprovalGate } from '../../src/streaming-edit/approval-gate.js';
import type { Timers } from '../../src/streaming-edit/types.js';

function fakeTimers(): Timers & { tick: (ms: number) => void } {
  const pending: Array<{ fn: () => void; dueAt: number; id: number }> = [];
  let now = 0;
  let nextId = 1;
  return {
    setTimeout(fn, ms) {
      const id = nextId++;
      pending.push({ fn, dueAt: now + ms, id });
      return id;
    },
    clearTimeout(handle) {
      const idx = pending.findIndex((p) => p.id === handle);
      if (idx >= 0) pending.splice(idx, 1);
    },
    tick(ms) {
      now += ms;
      const due = pending.filter((p) => p.dueAt <= now);
      for (const p of due) {
        const idx = pending.indexOf(p);
        if (idx >= 0) pending.splice(idx, 1);
        p.fn();
      }
    },
  };
}

function preview(): streaming.ToolCallPreviewEvent {
  return {
    kind: 'tool-call-preview',
    turnId: 't1',
    at: '2026-04-17T00:00:00.000Z',
    toolName: 'send_email',
    args: { to: 'a@b.c' },
    previewStrategy: 'preview-approval',
    approvalId: 'app-1',
  };
}

function sink(): streaming.StreamingSink & { events: streaming.StreamEvent[] } {
  const events: streaming.StreamEvent[] = [];
  return { emit: (e) => events.push(e), events };
}

describe('ApprovalGate', () => {
  it('approve-before-timeout → resolves { approved: true }', async () => {
    const timers = fakeTimers();
    const s = sink();
    const gate = new ApprovalGate({ streamSink: s, mode: 'strict', timers });
    const resolver = vi.fn().mockResolvedValue({ approvalId: 'app-1', approved: true });
    const result = await gate.wait(preview(), resolver);
    expect(result.approved).toBe(true);
    expect(s.events).toHaveLength(0); // no timeout event emitted
  });

  it('reject-before-timeout → resolves { approved: false }', async () => {
    const timers = fakeTimers();
    const s = sink();
    const gate = new ApprovalGate({ streamSink: s, mode: 'strict', timers });
    const resolver = vi
      .fn()
      .mockResolvedValue({ approvalId: 'app-1', approved: false, reason: 'user said no' });
    const result = await gate.wait(preview(), resolver);
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('user said no');
  });

  it('strict-mode timeout → rejects + emits tool-call-rejected StreamEvent', async () => {
    const timers = fakeTimers();
    const s = sink();
    const gate = new ApprovalGate({ streamSink: s, mode: 'strict', timers });
    // Resolver never settles.
    const resolver = () => new Promise<streaming.ApprovalDecision>(() => {});
    const pending = gate.wait(preview(), resolver);
    timers.tick(30_001); // default strict = 30_000
    const result = await pending;
    expect(result.approved).toBe(false);
    expect(result.reason).toBe('timeout');
    expect(s.events).toHaveLength(1);
    expect(s.events[0]!.kind).toBe('tool-call-rejected');
  });

  it('permissive-mode timeout → approves + emits tool-call-rejected StreamEvent (truthful narration)', async () => {
    const timers = fakeTimers();
    const s = sink();
    const gate = new ApprovalGate({ streamSink: s, mode: 'permissive', timers });
    const resolver = () => new Promise<streaming.ApprovalDecision>(() => {});
    const pending = gate.wait(preview(), resolver);
    timers.tick(120_001); // permissive default
    const result = await pending;
    expect(result.approved).toBe(true);
    expect(result.reason).toBe('timeout-permissive');
    // StreamEvent is still "rejected" for truthful narration of what happened.
    expect(s.events).toHaveLength(1);
    expect(s.events[0]!.kind).toBe('tool-call-rejected');
  });

  it('per-call timeoutMs + onTimeout override wins over session default', async () => {
    const timers = fakeTimers();
    const s = sink();
    const gate = new ApprovalGate({
      streamSink: s,
      mode: 'strict',
      sessionTimeoutMs: 30_000,
      timers,
    });
    const resolver = () => new Promise<streaming.ApprovalDecision>(() => {});
    const pending = gate.wait(preview(), resolver, { timeoutMs: 500, onTimeout: 'approve' });
    timers.tick(501);
    const result = await pending;
    // Per-call override wins: 500ms timeout with approve-on-timeout.
    expect(result.approved).toBe(true);
    expect(result.reason).toBe('timeout-permissive');
  });
});
