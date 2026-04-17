import { describe, expect, it } from 'vitest';

import { reduceStreamState } from '../../src/api/streaming.js';
import type { StreamEvent } from '../../src/api/streaming.js';

function ev(partial: Partial<StreamEvent> & { kind: StreamEvent['kind'] }): StreamEvent {
  return { turnId: 't', at: 'x', ...partial };
}

describe('reduceStreamState', () => {
  it('turn-started resets accumulated + sets streaming', () => {
    const next = reduceStreamState(
      { events: [], accumulated: 'leftover', pendingApproval: null, status: 'done' },
      ev({ kind: 'turn-started', input: 'hi' }),
    );
    expect(next.accumulated).toBe('');
    expect(next.status).toBe('streaming');
  });

  it('tokens append to accumulated', () => {
    let s = reduceStreamState(
      { events: [], accumulated: '', pendingApproval: null, status: 'streaming' },
      ev({ kind: 'token', text: 'he' }),
    );
    s = reduceStreamState(s, ev({ kind: 'token', text: 'llo' }));
    expect(s.accumulated).toBe('hello');
  });

  it('tool-call-preview sets pendingApproval + awaiting-approval status', () => {
    const s = reduceStreamState(
      { events: [], accumulated: '', pendingApproval: null, status: 'streaming' },
      ev({
        kind: 'tool-call-preview',
        approvalId: 'a',
        toolName: 't',
        previewStrategy: 'preview-approval',
      }),
    );
    expect(s.status).toBe('awaiting-approval');
    expect(s.pendingApproval?.approvalId).toBe('a');
  });

  it('tool-call-approved clears pendingApproval', () => {
    const s0 = reduceStreamState(
      { events: [], accumulated: '', pendingApproval: null, status: 'streaming' },
      ev({ kind: 'tool-call-preview', approvalId: 'a', toolName: 't' }),
    );
    const s1 = reduceStreamState(s0, ev({ kind: 'tool-call-approved', approvalId: 'a', toolName: 't' }));
    expect(s1.pendingApproval).toBeNull();
    expect(s1.status).toBe('streaming');
  });

  it('done sets status to done', () => {
    const s = reduceStreamState(
      { events: [], accumulated: 'hi', pendingApproval: null, status: 'streaming' },
      ev({ kind: 'done', reason: 'ok' }),
    );
    expect(s.status).toBe('done');
  });

  it('error transitions to error status', () => {
    const s = reduceStreamState(
      { events: [], accumulated: '', pendingApproval: null, status: 'streaming' },
      ev({ kind: 'error', code: 'X', message: 'y' }),
    );
    expect(s.status).toBe('error');
  });
});
