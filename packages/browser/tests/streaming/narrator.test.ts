import { describe, expect, it, vi } from 'vitest';

import { BufferSink, EmitterSink, Narrator } from '../../src/streaming/narrator.js';

describe('Narrator', () => {
  it('BufferSink retains every event up to capacity', () => {
    const sink = new BufferSink(3);
    const n = new Narrator(sink, 'task-1');
    n.started('hello');
    n.step('step 1');
    n.step('step 2');
    n.step('step 3');
    const all = sink.all();
    expect(all).toHaveLength(3);
    expect(all[0]!.message).toBe('step 1'); // first one pushed out
  });

  it('EmitterSink fires callbacks on each event', () => {
    const sink = new EmitterSink();
    const fn = vi.fn();
    sink.on(fn);
    const n = new Narrator(sink, 'task-emit');
    n.toolPreview('send_email', { to: 'a@b.c' });
    n.toolExecuted('send_email');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn.mock.calls[0]![0].kind).toBe('tool-preview');
    expect(fn.mock.calls[1]![0].toolName).toBe('send_email');
  });

  it('emits screenshots + interrupt + awaiting-approval + failed', () => {
    const sink = new BufferSink();
    const n = new Narrator(sink, 'task-x');
    n.screenshot('AAAA', 'halfway');
    n.awaitingApproval('approve to proceed');
    n.interrupted('user aborted');
    n.failed('ran out of retries');
    const kinds = sink.all().map((e) => e.kind);
    expect(kinds).toEqual(['screenshot', 'awaiting-approval', 'interrupted', 'task-failed']);
  });

  it('every event carries taskId + at', () => {
    const sink = new BufferSink();
    const now = () => '2026-04-17T00:00:00.000Z';
    const n = new Narrator(sink, 'tid', now);
    n.done();
    const ev = sink.all()[0]!;
    expect(ev.taskId).toBe('tid');
    expect(ev.at).toBe('2026-04-17T00:00:00.000Z');
  });
});
