import { useEffect, useRef, type ReactElement } from 'react';

import type { AgentStreamState } from '../api/streaming.js';

export interface StreamingMessageProps {
  readonly state: AgentStreamState;
  readonly onInterrupt?: () => void;
}

export function StreamingMessage({ state, onInterrupt }: StreamingMessageProps): ReactElement {
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const [isStickToBottom, setStickToBottom] = useStickToBottom();

  useEffect(() => {
    if (isStickToBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.accumulated, isStickToBottom]);

  return (
    <div
      className="rounded border border-slate-200 bg-white p-4 text-sm text-slate-900"
      role="region"
      aria-label="streaming assistant message"
    >
      <div
        className="max-h-96 overflow-y-auto whitespace-pre-wrap"
        onScroll={(e) => {
          const el = e.currentTarget;
          setStickToBottom(el.scrollHeight - el.scrollTop <= el.clientHeight + 16);
        }}
      >
        {state.accumulated}
        <div ref={bottomRef} />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <StatusBadge status={state.status} />
        {state.status === 'streaming' && onInterrupt && (
          <button
            type="button"
            onClick={onInterrupt}
            className="rounded bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700 hover:bg-rose-100"
          >
            Interrupt
          </button>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: AgentStreamState['status'] }): ReactElement {
  const map: Record<AgentStreamState['status'], string> = {
    idle: 'bg-slate-100 text-slate-600',
    streaming: 'bg-blue-50 text-blue-700',
    'awaiting-approval': 'bg-amber-50 text-amber-800',
    done: 'bg-emerald-50 text-emerald-700',
    error: 'bg-rose-50 text-rose-700',
  };
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${map[status]}`} data-testid="stream-status">
      {status}
    </span>
  );
}

function useStickToBottom(): [boolean, (v: boolean) => void] {
  const ref = useRef(true);
  return [ref.current, (v) => { ref.current = v; }];
}
