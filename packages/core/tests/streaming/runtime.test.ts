import { describe, expect, it, vi } from 'vitest';

import { BufferStreamSink, StreamingRuntime } from '../../src/streaming/runtime.js';
import type { StreamEventSource } from '../../src/streaming/runtime.js';
import type { ApprovalResolver, StreamEvent } from '../../src/streaming/types.js';

async function* sequence(steps: StreamEventSource[]): AsyncIterable<StreamEventSource> {
  for (const step of steps) yield step;
}

describe('StreamingRuntime', () => {
  it('emits turn-started + tokens + done for a pure-text turn', async () => {
    const sink = new BufferStreamSink();
    const rt = new StreamingRuntime({ sink });
    await rt.stream({ input: 'hi' }, sequence([{ kind: 'token', text: 'he' }, { kind: 'token', text: 'llo' }]));
    const kinds = sink.events.map((e) => e.kind);
    expect(kinds).toEqual(['turn-started', 'token', 'token', 'done']);
    expect((sink.events[1] as { text: string }).text).toBe('he');
  });

  it('auto-executes tools marked auto-execute', async () => {
    const sink = new BufferStreamSink();
    const rt = new StreamingRuntime({ sink });
    rt.register({
      name: 'fetch',
      strategy: 'auto-execute',
      async execute() { return 'ok'; },
    });
    await rt.stream({ input: 'x' }, sequence([
      { kind: 'tool-call', toolName: 'fetch', args: { url: '/x' } },
    ]));
    const kinds = sink.events.map((e) => e.kind);
    expect(kinds).toEqual(['turn-started', 'tool-call-execute', 'tool-result', 'done']);
  });

  it('previews + waits for approval when strategy=preview-approval', async () => {
    const sink = new BufferStreamSink();
    const approve: ApprovalResolver = vi.fn(async (preview) => ({
      approvalId: preview.approvalId,
      approved: true,
    }));
    const rt = new StreamingRuntime({ sink, approve });
    rt.register({
      name: 'send_email',
      strategy: 'preview-approval',
      async execute() { return 'sent'; },
    });
    await rt.stream({ input: 'send' }, sequence([
      { kind: 'tool-call', toolName: 'send_email', args: { to: 'x@y' } },
    ]));
    const kinds = sink.events.map((e) => e.kind);
    expect(kinds).toEqual([
      'turn-started',
      'tool-call-preview',
      'tool-call-approved',
      'tool-call-execute',
      'tool-result',
      'done',
    ]);
    expect(approve).toHaveBeenCalledOnce();
  });

  it('rejects the tool when approver returns approved=false', async () => {
    const sink = new BufferStreamSink();
    const approve: ApprovalResolver = async (p) => ({ approvalId: p.approvalId, approved: false, reason: 'no' });
    const rt = new StreamingRuntime({ sink, approve });
    rt.register({ name: 'dangerous', strategy: 'preview-approval', async execute() { return 'nope'; } });
    const result = await rt.stream({ input: 'do it' }, sequence([
      { kind: 'tool-call', toolName: 'dangerous', args: {} },
    ]));
    expect(result.aborted).toBe(true);
    expect(sink.events.some((e) => e.kind === 'tool-call-rejected')).toBe(true);
    expect(sink.events.some((e) => e.kind === 'tool-call-execute')).toBe(false);
  });

  it('emits progress events from long-running tools', async () => {
    const sink = new BufferStreamSink();
    const rt = new StreamingRuntime({ sink });
    rt.register({
      name: 'long',
      strategy: 'auto-execute',
      async execute(_args, reportProgress) {
        reportProgress({ label: 'downloading', fraction: 0.25 });
        reportProgress({ label: 'parsing', fraction: 0.75 });
        return 'done';
      },
    });
    await rt.stream({ input: 'go' }, sequence([{ kind: 'tool-call', toolName: 'long', args: {} }]));
    const progress = sink.events.filter((e) => e.kind === 'progress');
    expect(progress).toHaveLength(2);
  });

  it('honors interrupt → emits interrupted + stops consuming steps', async () => {
    const sink = new BufferStreamSink();
    const rt = new StreamingRuntime({ sink });
    const result = await rt.stream({ input: 'x' }, sequence([
      { kind: 'token', text: 'he' },
      { kind: 'abort', reason: 'user-pressed-ctrl-c' },
      { kind: 'token', text: 'llo' },
    ]));
    expect(result.aborted).toBe(true);
    expect(result.reason).toBe('user-pressed-ctrl-c');
    const kinds = sink.events.map((e) => e.kind);
    expect(kinds).toContain('interrupted');
    expect(kinds.filter((k) => k === 'token')).toHaveLength(1); // second token never emitted
  });

  it('error event when preview-approval needs an approver and none is wired', async () => {
    const sink = new BufferStreamSink();
    const rt = new StreamingRuntime({ sink });
    rt.register({ name: 'x', strategy: 'preview-approval', async execute() { return 'nope'; } });
    await rt.stream({ input: 'x' }, sequence([{ kind: 'tool-call', toolName: 'x', args: {} }]));
    const hasError = sink.events.some((e: StreamEvent) => e.kind === 'error' && e.code === 'HIPP0_STREAMING_NO_APPROVER');
    expect(hasError).toBe(true);
  });

  it('strategyOverride escalates all tools to preview-approval', async () => {
    const sink = new BufferStreamSink();
    const approve: ApprovalResolver = async (p) => ({ approvalId: p.approvalId, approved: true });
    const rt = new StreamingRuntime({
      sink,
      approve,
      strategyOverride: () => 'preview-approval',
    });
    rt.register({ name: 'read', strategy: 'auto-execute', async execute() { return 'data'; } });
    await rt.stream({ input: 'x' }, sequence([{ kind: 'tool-call', toolName: 'read', args: {} }]));
    expect(sink.events.some((e) => e.kind === 'tool-call-preview')).toBe(true);
  });
});
