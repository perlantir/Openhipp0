import { useState } from 'react';
import { PageHeader } from '../components/PageHeader.js';
import { useWebSocket } from '../hooks/useWebSocket.js';

export interface ChatProps {
  /** URL of the bridge Gateway's web bridge. Defaults to same-host /ws. */
  url?: string | null;
  /** Injected WebSocket constructor (tests). */
  webSocketCtor?: typeof WebSocket;
}

interface ChatFrame {
  type: 'message' | 'response' | 'status' | 'button';
  content?: string;
  from?: string;
}

/** Chat — live conversation with the agent via the web bridge. */
export function Chat({ url, webSocketCtor }: ChatProps) {
  const [draft, setDraft] = useState('');
  const opts: Parameters<typeof useWebSocket<ChatFrame>>[0] = {
    url: url ?? (typeof window === 'undefined' ? null : `ws://${window.location.host}/ws`),
  };
  if (webSocketCtor) opts.webSocketCtor = webSocketCtor;
  const { status, messages, send } = useWebSocket<ChatFrame>(opts);

  function onSend(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim()) return;
    send({ type: 'message', content: draft });
    setDraft('');
  }

  return (
    <>
      <PageHeader
        title="Chat"
        subtitle={
          <>
            Status:{' '}
            <span
              data-testid="ws-status"
              className={
                status === 'open'
                  ? 'text-green-600'
                  : status === 'error'
                    ? 'text-red-600'
                    : 'text-slate-500'
              }
            >
              {status}
            </span>
          </>
        }
      />
      <section
        data-testid="chat-log"
        className="mb-4 h-96 overflow-auto rounded border border-slate-200 p-3 text-sm"
      >
        {messages.length === 0 ? (
          <p className="text-slate-500">No messages yet.</p>
        ) : (
          messages.map((m, i) => (
            <div key={i} className="mb-1">
              <span className="font-semibold">{m.from ?? m.type}:</span>{' '}
              <span>{m.content ?? ''}</span>
            </div>
          ))
        )}
      </section>
      <form onSubmit={onSend} className="flex gap-2">
        <input
          aria-label="Message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Type a message…"
          className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status !== 'open'}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </>
  );
}
