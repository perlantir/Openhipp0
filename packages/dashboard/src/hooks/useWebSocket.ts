import { useEffect, useRef, useState } from 'react';

/**
 * Minimal WebSocket hook for the dashboard Chat page.
 *
 * Connects to the bridge Gateway's WebSocket endpoint (the `web` bridge from
 * Phase 3b), buffers inbound JSON frames, and exposes a `send` function. On
 * mount: open. On unmount or URL change: close. Reconnect is intentionally
 * NOT handled here — the Chat page shows a status banner so users notice
 * disconnects and refresh, which is preferable to silent resubscription
 * during the Phase 7 UI-only milestone.
 *
 * The WebSocket constructor is injectable so tests can use a fake class.
 */

export type WebSocketStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface UseWebSocketOptions<T = unknown> {
  /** URL to connect to. null = skip connecting (useful for gating). */
  url: string | null;
  /** Override the WebSocket constructor (tests). Defaults to globalThis.WebSocket. */
  webSocketCtor?: typeof WebSocket;
  /** Parse an incoming frame's `event.data` into typed messages. Default: JSON.parse. */
  parse?: (raw: string) => T;
}

export interface UseWebSocketResult<T> {
  status: WebSocketStatus;
  messages: readonly T[];
  send(data: string | object): void;
  clear(): void;
}

export function useWebSocket<T = unknown>(opts: UseWebSocketOptions<T>): UseWebSocketResult<T> {
  const [status, setStatus] = useState<WebSocketStatus>('connecting');
  const [messages, setMessages] = useState<T[]>([]);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (opts.url === null) {
      setStatus('closed');
      return;
    }
    const Ctor = opts.webSocketCtor ?? globalThis.WebSocket;
    if (!Ctor) {
      setStatus('error');
      return;
    }
    const ws = new Ctor(opts.url);
    socketRef.current = ws;
    setStatus('connecting');

    ws.addEventListener('open', () => setStatus('open'));
    ws.addEventListener('close', () => setStatus('closed'));
    ws.addEventListener('error', () => setStatus('error'));
    ws.addEventListener('message', (e: MessageEvent) => {
      try {
        const parsed = opts.parse
          ? opts.parse(String(e.data))
          : (JSON.parse(String(e.data)) as T);
        setMessages((m) => [...m, parsed]);
      } catch {
        // Drop unparseable frames silently — Phase 7 is UI only.
      }
    });

    return () => {
      ws.close();
      socketRef.current = null;
    };
    // Intentional: only opts.url is a dep. opts.parse / webSocketCtor are
    // expected to be stable references by callers; re-running on URL change
    // is the interesting trigger. If a caller passes unstable callbacks, they
    // should memo them upstream.
  }, [opts.url]);

  function send(data: string | object): void {
    const ws = socketRef.current;
    if (!ws || ws.readyState !== 1 /* OPEN */) return;
    const frame = typeof data === 'string' ? data : JSON.stringify(data);
    ws.send(frame);
  }

  function clear(): void {
    setMessages([]);
  }

  return { status, messages, send, clear };
}
