import { useState } from 'react';
import { PageHeader } from '../components/PageHeader.js';
import { useWebSocket } from '../hooks/useWebSocket.js';

export interface ChatProps {
  /** URL of the bridge Gateway's web bridge. Defaults to same-host /ws. */
  url?: string | null;
  /** Injected WebSocket constructor (tests). */
  webSocketCtor?: typeof WebSocket;
  /** Project id feedback is attributed to. Default: 'default'. */
  projectId?: string;
  /** User id attributed to every rating. Default: 'dashboard-user'. */
  userId?: string;
  /** Override the feedback POST target for tests. */
  feedbackEndpoint?: string;
  /** Injected fetch (tests). */
  fetchImpl?: typeof fetch;
}

interface ChatFrame {
  type: 'message' | 'response' | 'status' | 'button';
  content?: string;
  from?: string;
  id?: string;
}

type RatingState = Record<string, 1 | -1 | 0>;

/** Chat — live conversation with the agent via the web bridge. */
export function Chat({
  url,
  webSocketCtor,
  projectId = 'default',
  userId = 'dashboard-user',
  feedbackEndpoint = '/api/feedback',
  fetchImpl,
}: ChatProps) {
  const [draft, setDraft] = useState('');
  const [ratings, setRatings] = useState<RatingState>({});
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

  async function rate(turnKey: string, rating: 1 | -1) {
    // Rate-limit: one rating per turn. Subsequent clicks on the same thumb
    // toggle the rating off; clicking the other thumb replaces it.
    const previous = ratings[turnKey] ?? 0;
    const next: 1 | -1 | 0 = previous === rating ? 0 : rating;
    setRatings((s) => ({ ...s, [turnKey]: next }));
    try {
      await (fetchImpl ?? fetch)(feedbackEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectId,
          userId,
          turnId: turnKey,
          rating: next,
          source: 'explicit',
        }),
      });
    } catch {
      // Revert on failure so the UI reflects the server's view.
      setRatings((s) => ({ ...s, [turnKey]: previous }));
    }
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
          messages.map((m, i) => {
            const turnKey = `turn-${i}`;
            const rating = ratings[turnKey] ?? 0;
            const isAssistant = m.type === 'response';
            return (
              <div key={i} className="mb-2">
                <div>
                  <span className="font-semibold">{m.from ?? m.type}:</span>{' '}
                  <span>{m.content ?? ''}</span>
                </div>
                {isAssistant && (
                  <div className="mt-1 flex gap-1 text-xs text-slate-500">
                    <button
                      type="button"
                      aria-label="Thumbs up"
                      data-testid={`thumb-up-${i}`}
                      onClick={() => void rate(turnKey, 1)}
                      className={
                        'rounded border px-2 py-0.5 ' +
                        (rating === 1
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-slate-300 hover:bg-slate-50')
                      }
                    >
                      👍
                    </button>
                    <button
                      type="button"
                      aria-label="Thumbs down"
                      data-testid={`thumb-down-${i}`}
                      onClick={() => void rate(turnKey, -1)}
                      className={
                        'rounded border px-2 py-0.5 ' +
                        (rating === -1
                          ? 'border-red-500 bg-red-50 text-red-700'
                          : 'border-slate-300 hover:bg-slate-50')
                      }
                    >
                      👎
                    </button>
                  </div>
                )}
              </div>
            );
          })
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
