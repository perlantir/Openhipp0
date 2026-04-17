import { describe, expect, it, vi } from 'vitest';

import { formatStreamEvent, SentenceChunker, StreamingAccumulator } from '../src/streaming.js';
import type { streaming } from '@openhipp0/core';

type StreamEvent = streaming.StreamEvent;

function mk<T extends StreamEvent>(e: T): T {
  return e;
}

describe('formatStreamEvent', () => {
  it('tokens pass through verbatim', () => {
    expect(formatStreamEvent(mk({ kind: 'token', turnId: 't', at: 'x', text: 'hello' }))).toBe('hello');
  });

  it('tool previews render with summary', () => {
    const out = formatStreamEvent(
      mk({
        kind: 'tool-call-preview',
        turnId: 't',
        at: 'x',
        toolName: 'send_email',
        args: {},
        previewStrategy: 'preview-approval',
        approvalId: 'a1',
        summary: 'to: a@b',
      }),
    );
    expect(out).toContain('send_email');
    expect(out).toContain('to: a@b');
    expect(out).toContain('awaiting approval');
  });

  it('errors include external code when set', () => {
    const out = formatStreamEvent(
      mk({ kind: 'error', turnId: 't', at: 'x', code: 'X', message: 'y', externalCode: 'HIPP0-0001' }),
    );
    expect(out).toContain('HIPP0-0001');
  });

  it('turn-started and done produce empty string (transport-managed)', () => {
    expect(formatStreamEvent(mk({ kind: 'turn-started', turnId: 't', at: 'x', input: '' }))).toBe('');
    expect(formatStreamEvent(mk({ kind: 'done', turnId: 't', at: 'x', reason: 'ok' }))).toBe('');
  });
});

describe('StreamingAccumulator', () => {
  it('accumulates tokens and fires handle on every event', async () => {
    const handle = vi.fn();
    const acc = new StreamingAccumulator({ handle });
    await acc.push(mk({ kind: 'turn-started', turnId: 't', at: 'x', input: 'hi' }));
    await acc.push(mk({ kind: 'token', turnId: 't', at: 'x', text: 'he' }));
    await acc.push(mk({ kind: 'token', turnId: 't', at: 'x', text: 'llo' }));
    expect(acc.text).toBe('hello');
    expect(handle).toHaveBeenCalledTimes(3);
  });
});

describe('SentenceChunker', () => {
  it('flushes at sentence boundaries once min is reached', () => {
    const c = new SentenceChunker({ minChunkChars: 10, maxChunkChars: 200 });
    expect(c.push('short. ')).toBeNull(); // under min
    const out = c.push('Now we have a real sentence. Another part. ');
    expect(out).toBeTruthy();
    expect(out!.trim().endsWith('.')).toBe(true);
  });

  it('hard-flushes at max when no boundary fits', () => {
    const c = new SentenceChunker({ minChunkChars: 5, maxChunkChars: 20 });
    const chunk = c.push('abcdefghijklmnopqrstuvwxyz'); // no boundaries
    expect(chunk?.length).toBe(20);
  });

  it('flush() drains remaining', () => {
    const c = new SentenceChunker({ minChunkChars: 100, maxChunkChars: 1000 });
    c.push('a few words here');
    const rest = c.flush();
    expect(rest).toContain('a few words');
  });
});
