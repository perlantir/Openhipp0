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
      // Drain microtasks. setImmediate runs AFTER the current
      // microtask queue, so one round picks up the entire
      // #fire → onFlush → applyEdit → editFn → handleEditError chain.
      await new Promise<void>((resolve) => setImmediate(resolve));
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
    // editFn: 1 rate-limit, 2 transient, 3 parse-error (absorbed), 4 success, 5 permanent.
    let call = 0;
    const editFn = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new StreamingEditError('rate-limit', '429', { retryAfterMs: 200 });
      if (call === 2) throw new StreamingEditError('transient', 'socket hiccup');
      if (call === 3) throw new StreamingEditError('parse-error', 'bad markup frame');
      if (call === 4) return undefined;
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

    // Rate-limit (call 1): multiplier doubles, lastRetryAfterMs captured.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'one' }));
    await timers.tick(500);
    expect(session.currentMultiplier()).toBe(2);
    expect(session.lastRetryAfterMs()).toBe(200);

    // Transient (call 2): no multiplier change; retry happens on the
    // next debouncer arm, which runs at 2× base (1000ms) due to backoff.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'onetwo' }));
    await timers.tick(1000);
    expect(session.currentMultiplier()).toBe(2);
    expect(session.isPermanentlyFailed()).toBe(false);

    // Parse-error mid-stream (call 3): absorbed — blocker #4 fix. Not
    // permanent, not a multiplier change.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'onetwothree' }));
    await timers.tick(1000);
    expect(session.isPermanentlyFailed()).toBe(false);
    expect(session.currentMultiplier()).toBe(2);

    // Success (call 4): lastRetryAfterMs clears.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'onetwothreefour' }));
    await timers.tick(1000);
    expect(session.isPermanentlyFailed()).toBe(false);
    expect(session.lastRetryAfterMs()).toBeNull();

    // Permanent (call 5): session disabled.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'onetwothreefourfive' }));
    await timers.tick(1000);
    expect(session.isPermanentlyFailed()).toBe(true);
    expect(sink.events.some((e) => e.kind === 'error' && e.code === 'HIPP0_BRIDGE_STREAMING_EDIT_PERMANENT')).toBe(true);

    // Subsequent feed() is a no-op.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'after' }));
    await timers.tick(1000);
    expect(editFn).toHaveBeenCalledTimes(5); // no 6th call
  });

  it('rate-limit backoff delays the NEXT edit by multiplier × base', async () => {
    const timers = fakeTimers();
    let call = 0;
    const editFn = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new StreamingEditError('rate-limit', '429');
      // subsequent succeed
    });
    const baseDelayMs = 500;
    const session = new StreamingEditSession({
      target: { channelId: 'c1', rootMessageId: 'msg-rl' },
      editFn,
      sendFn: vi.fn(),
      streamSink: captureSink(),
      debounceMs: baseDelayMs,
      maxMessageBytes: 10_000,
      timers,
    });

    // First push fires at 500ms → rate-limit → multiplier 2×.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'foo' }));
    await timers.tick(baseDelayMs);
    expect(call).toBe(1);
    expect(session.currentMultiplier()).toBe(2);

    // Second push must wait 2× base (1000ms). Ticking only base must
    // NOT fire — if it does, the multiplier isn't being applied.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'foobar' }));
    await timers.tick(baseDelayMs); // 500ms of a 1000ms timer
    expect(call).toBe(1);
    await timers.tick(baseDelayMs); // total 1000ms → fires
    expect(call).toBe(2);
  });

  it('rate-limit retryAfterMs overrides multiplier × base when larger', async () => {
    const timers = fakeTimers();
    let call = 0;
    const editFn = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 1) throw new StreamingEditError('rate-limit', '429', { retryAfterMs: 5000 });
    });
    const session = new StreamingEditSession({
      target: { channelId: 'c1', rootMessageId: 'msg-rl2' },
      editFn,
      sendFn: vi.fn(),
      streamSink: captureSink(),
      debounceMs: 500,
      maxMessageBytes: 10_000,
      timers,
    });
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'x' }));
    await timers.tick(500);
    expect(session.lastRetryAfterMs()).toBe(5000);

    // Multiplier × base = 1000ms; retryAfterMs=5000 wins.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: 'xy' }));
    await timers.tick(4999);
    expect(call).toBe(1);
    await timers.tick(1);
    expect(call).toBe(2);
  });

  it('approval resolver that throws does NOT crash session; emits resolver-error + applies mode policy', async () => {
    const timers = fakeTimers();
    const approvalResolver = vi.fn().mockRejectedValue(new Error('webhook returned malformed JSON'));
    const sink = captureSink();
    const session = new StreamingEditSession({
      target: { channelId: 'c1', rootMessageId: 'msg-r' },
      editFn: vi.fn().mockResolvedValue(undefined),
      sendFn: vi.fn(),
      streamSink: sink,
      debounceMs: 500,
      maxMessageBytes: 10_000,
      approvalResolver,
      approvalTimeoutMode: 'strict',
      timers,
    });
    await session.feed(
      ev({
        kind: 'tool-call-preview',
        turnId: 't',
        at: 'a',
        toolName: 'send_email',
        args: {},
        previewStrategy: 'preview-approval',
        approvalId: 'app-xy',
      }),
    );
    // resolver-error event + downstream decision event; session alive.
    const resolverErrEv = sink.events.find(
      (e) =>
        e.kind === 'tool-call-rejected' &&
        'reason' in e &&
        typeof e.reason === 'string' &&
        e.reason.includes('resolver-error'),
    );
    expect(resolverErrEv).toBeTruthy();
    expect(session.isPermanentlyFailed()).toBe(false);
  });

  it('non-ASCII text streaming across a rotation boundary keeps the accumulator offset correct', async () => {
    const timers = fakeTimers();
    const editFn = vi.fn().mockResolvedValue(undefined);
    const sendFn = vi.fn().mockResolvedValue('msg-2');
    const finalFormatEdit = vi.fn().mockResolvedValue(undefined);
    const session = new StreamingEditSession({
      target: { channelId: 'c1', rootMessageId: 'msg-1' },
      editFn,
      sendFn,
      streamSink: captureSink(),
      debounceMs: 500,
      maxMessageBytes: 12, // 6 pounds = 12 bytes; tight to force rotation
      finalFormatEdit,
      timers,
    });
    // 10 £ = 20 UTF-8 bytes, 10 JS-string chars. 12-byte cap keeps 6,
    // carries 4.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: '£'.repeat(10) }));
    await timers.tick(500);
    expect(editFn).toHaveBeenCalledOnce();
    expect(editFn.mock.calls[0]![1]).toBe('£'.repeat(6));
    expect(sendFn).toHaveBeenCalledOnce();
    expect(sendFn.mock.calls[0]![0]).toBe('£'.repeat(4));

    // Second token: accumulator now has 18 £ total; offset should be 6
    // (JS-string chars), so new message's slice is 12 pounds. That's
    // 24 bytes → rotates again, keep 6 / carry 6.
    await session.feed(ev({ kind: 'token', turnId: 't', at: 'a', text: '£'.repeat(8) }));
    await timers.tick(500);
    // Edit on msg-2 with the carry (4) + first 2 new = 6 pounds kept.
    const secondEdit = editFn.mock.calls[editFn.mock.calls.length - 1]!;
    expect(secondEdit[0]).toBe('msg-2');
    expect(secondEdit[1]).toBe('£'.repeat(6));
  });
});
