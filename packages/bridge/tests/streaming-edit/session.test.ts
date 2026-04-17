import { describe, expect, it, vi } from 'vitest';

import type { streaming } from '@openhipp0/core';

import { StreamingEditSession } from '../../src/streaming-edit/session.js';
import { StreamingEditError, type Timers } from '../../src/streaming-edit/types.js';

function fakeTimers(): Timers & { tick: (ms: number) => Promise<void> } {
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
    async tick(ms) {
      now += ms;
      const due = pending.filter((p) => p.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
      for (const p of due) {
        const idx = pending.indexOf(p);
        if (idx >= 0) pending.splice(idx, 1);
        p.fn();
      }
      await Promise.resolve();
      await Promise.resolve();
    },
  };
}

function captureSink(): streaming.StreamingSink & { events: streaming.StreamEvent[] } {
  const events: streaming.StreamEvent[] = [];
  return { emit: (e) => events.push(e), events };
}

function ev<T extends streaming.StreamEvent>(e: T): T {
  return e;
}

describe('StreamingEditSession', () => {
  it('routes tokens through debouncer; flush-on-done + finalFormatEdit invoked per rotated message', async () => {
    const timers = fakeTimers();
    const editFn = vi.fn().mockResolvedValue(undefined);
    const sendFn = vi.fn().mockResolvedValue('msg-1');
    const finalFormatEdit = vi.fn().mockResolvedValue(undefined);
    const sink = captureSink();
    const session = new StreamingEditSession({
      target: { channelId: 'c1', rootMessageId: 'msg-0' },
      editFn,
      sendFn,
      streamSink: sink,
      debounceMs: 1000,
      maxMessageBytes: 10_000,
      finalFormatEdit,
      timers,
    });
    await session.feed(ev({ kind: 'turn-started', turnId: 't', at: 'a', input: 'hi' }));
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'hello ' }));
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'world' }));
    // Timer hasn't fired yet — editFn not called.
    expect(editFn).not.toHaveBeenCalled();
    await session.feed(ev({ kind: 'done', turnId: 't', at: 'a', reason: 'ok' }));
    // done triggers flush: one edit + one finalFormatEdit.
    expect(editFn).toHaveBeenCalledOnce();
    expect(editFn.mock.calls[0]![0]).toBe('msg-0');
    expect(editFn.mock.calls[0]![1]).toBe('hello world');
    expect(finalFormatEdit).toHaveBeenCalledOnce();
    expect(finalFormatEdit.mock.calls[0]![0]).toBe('msg-0');
    expect(finalFormatEdit.mock.calls[0]![1]).toBe('hello world');
  });

  it('rotates via sendFn when accumulated text exceeds maxMessageBytes', async () => {
    const timers = fakeTimers();
    const editFn = vi.fn().mockResolvedValue(undefined);
    const sendFn = vi.fn().mockResolvedValue('msg-2');
    const finalFormatEdit = vi.fn().mockResolvedValue(undefined);
    const sink = captureSink();
    const session = new StreamingEditSession({
      target: { channelId: 'c1', rootMessageId: 'msg-1' },
      editFn,
      sendFn,
      streamSink: sink,
      debounceMs: 500,
      maxMessageBytes: 20,
      finalFormatEdit,
      timers,
    });
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'x'.repeat(30) }));
    await timers.tick(500);
    // One edit to msg-1 with the 'keep' portion, then sendFn for continuation.
    expect(editFn).toHaveBeenCalledOnce();
    expect(editFn.mock.calls[0]![0]).toBe('msg-1');
    expect(sendFn).toHaveBeenCalledOnce();
    await session.feed(ev({ kind: 'done', turnId: 't', at: 'a', reason: 'ok' }));
    // finalFormatEdit called once per rotated message.
    expect(finalFormatEdit).toHaveBeenCalledTimes(2);
    expect(finalFormatEdit.mock.calls[0]![0]).toBe('msg-1');
    expect(finalFormatEdit.mock.calls[1]![0]).toBe('msg-2');
  });

  it('tool-call-preview routes through ApprovalGate; session resumes after decision', async () => {
    const timers = fakeTimers();
    const editFn = vi.fn().mockResolvedValue(undefined);
    const sendFn = vi.fn();
    const approvalResolver = vi
      .fn<[streaming.ToolCallPreviewEvent], Promise<streaming.ApprovalDecision>>()
      .mockResolvedValue({ approvalId: 'app-1', approved: true });
    const sink = captureSink();
    const session = new StreamingEditSession({
      target: { channelId: 'c1', rootMessageId: 'msg-a' },
      editFn,
      sendFn,
      streamSink: sink,
      debounceMs: 1000,
      maxMessageBytes: 10_000,
      approvalResolver,
      timers,
    });
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'before ' }));
    await session.feed(
      ev({
        kind: 'tool-call-preview',
        turnId: 't',
        at: 'a',
        toolName: 'send_email',
        args: {},
        previewStrategy: 'preview-approval',
        approvalId: 'app-1',
      }),
    );
    // Gate called + decision emitted synthetically on the sink.
    expect(approvalResolver).toHaveBeenCalledOnce();
    expect(sink.events.some((e) => e.kind === 'tool-call-approved')).toBe(true);
  });

  it('absorbs StreamingEditError kinds (rate-limit / transient) + disables session on permanent', async () => {
    const timers = fakeTimers();
    // editFn: 1st throws rate-limit, 2nd throws transient, 3rd succeeds, 4th throws permanent.
    let call = 0;
    const editFn = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new StreamingEditError('rate-limit', '429', { retryAfterMs: 200 });
      if (call === 2) throw new StreamingEditError('transient', 'socket hiccup');
      if (call === 3) return undefined;
      throw new StreamingEditError('permanent', 'bridge revoked access');
    });
    const sendFn = vi.fn();
    const sink = captureSink();
    const session = new StreamingEditSession({
      target: { channelId: 'c1', rootMessageId: 'msg-err' },
      editFn,
      sendFn,
      streamSink: sink,
      debounceMs: 500,
      maxMessageBytes: 10_000,
      timers,
    });

    // Rate-limit (call 1).
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'one' }));
    await timers.tick(500);
    expect(session.currentMultiplier()).toBe(2);

    // Transient (call 2).
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'onetwo' }));
    await timers.tick(500);
    // No multiplier change for transient.
    expect(session.currentMultiplier()).toBe(2);

    // Success (call 3) — resets consecutiveOk counter toward decay.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'onetwothree' }));
    await timers.tick(500);
    expect(session.isPermanentlyFailed()).toBe(false);

    // Permanent (call 4).
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'onetwothreefour' }));
    await timers.tick(500);
    expect(session.isPermanentlyFailed()).toBe(true);
    expect(sink.events.some((e) => e.kind === 'error' && e.code === 'HIPP0_BRIDGE_STREAMING_EDIT_PERMANENT')).toBe(true);

    // Subsequent feed() is a no-op.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'after' }));
    await timers.tick(500);
    expect(editFn).toHaveBeenCalledTimes(4); // no 5th call
  });
});
