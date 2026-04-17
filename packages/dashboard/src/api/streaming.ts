/**
 * Dashboard-side stream-event mirror + hook. We mirror the `StreamEvent`
 * shape from `@openhipp0/core/streaming` so the dashboard doesn't pull
 * core at build time (core is node-only).
 */

import { useEffect, useRef, useState } from 'react';

export type StreamEventKind =
  | 'turn-started'
  | 'token'
  | 'partial'
  | 'tool-call-preview'
  | 'tool-call-approved'
  | 'tool-call-rejected'
  | 'tool-call-execute'
  | 'tool-result'
  | 'progress'
  | 'interrupted'
  | 'error'
  | 'done';

export interface StreamEvent {
  readonly kind: StreamEventKind;
  readonly turnId: string;
  readonly at: string;
  readonly text?: string;
  readonly toolName?: string;
  readonly args?: Readonly<Record<string, unknown>>;
  readonly approvalId?: string;
  readonly previewStrategy?:
    | 'auto-execute'
    | 'preview-auto-3s'
    | 'preview-approval'
    | 'preview-approval-typed';
  readonly summary?: string;
  readonly ok?: boolean;
  readonly result?: unknown;
  readonly error?: string;
  readonly label?: string;
  readonly fraction?: number | null;
  readonly reason?: string;
  readonly code?: string;
  readonly message?: string;
  readonly externalCode?: string;
  readonly totalTokens?: number;
  readonly input?: string;
}

export interface AgentStreamState {
  readonly events: readonly StreamEvent[];
  readonly accumulated: string;
  readonly pendingApproval: StreamEvent | null;
  readonly status: 'idle' | 'streaming' | 'awaiting-approval' | 'done' | 'error';
}

export interface UseAgentStreamDeps {
  /** Injects the event source for tests (normally a WebSocket listener). */
  readonly subscribe?: (cb: (event: StreamEvent) => void) => () => void;
}

const INITIAL: AgentStreamState = {
  events: [],
  accumulated: '',
  pendingApproval: null,
  status: 'idle',
};

export function reduceStreamState(state: AgentStreamState, event: StreamEvent): AgentStreamState {
  const events = [...state.events, event];
  switch (event.kind) {
    case 'turn-started':
      return { events, accumulated: '', pendingApproval: null, status: 'streaming' };
    case 'token':
    case 'partial':
      return { ...state, events, accumulated: state.accumulated + (event.text ?? '') };
    case 'tool-call-preview':
      return { ...state, events, pendingApproval: event, status: 'awaiting-approval' };
    case 'tool-call-approved':
    case 'tool-call-rejected':
      return { ...state, events, pendingApproval: null, status: 'streaming' };
    case 'tool-call-execute':
      return { ...state, events, status: 'streaming' };
    case 'tool-result':
      return { ...state, events };
    case 'progress':
      return { ...state, events };
    case 'interrupted':
      return { ...state, events, status: 'done' };
    case 'error':
      return { ...state, events, status: 'error' };
    case 'done':
      return { ...state, events, pendingApproval: null, status: 'done' };
    default:
      return { ...state, events };
  }
}

export function useAgentStream(deps: UseAgentStreamDeps = {}): AgentStreamState & {
  reset(): void;
  push(event: StreamEvent): void;
} {
  const [state, setState] = useState<AgentStreamState>(INITIAL);
  const subRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!deps.subscribe) return;
    const unsubscribe = deps.subscribe((event) => {
      setState((prev) => reduceStreamState(prev, event));
    });
    subRef.current = unsubscribe;
    return () => {
      unsubscribe();
      subRef.current = null;
    };
  }, [deps.subscribe]);

  return {
    ...state,
    reset: () => setState(INITIAL),
    push: (event) => setState((prev) => reduceStreamState(prev, event)),
  };
}
