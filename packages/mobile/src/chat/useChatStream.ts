// packages/mobile/src/chat/useChatStream.ts
// WebSocket hook for /ws chat. Mirrors the dashboard's useWebSocket shape
// but adapted for RN (no window globals, safe reconnect, paired bearer
// appended as a query param since RN WebSocket doesn't allow custom
// headers on the handshake).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSession } from "../store/session.js";

export type ChatRole = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  /** Streaming? Final chunk sets this to false. */
  streaming?: boolean;
  /** ISO timestamp. */
  createdAt: string;
}

export type ChatStatus = "idle" | "connecting" | "open" | "closed" | "error";

interface OutboundFrame {
  type: "message";
  text: string;
}

interface IncomingFrame {
  type: "message" | "response" | "status" | "approval-request";
  text?: string;
  final?: boolean;
  status?: string;
  approvalId?: string;
  prompt?: string;
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export interface UseChatStreamOptions {
  /** Injected for tests; defaults to global WebSocket. */
  webSocketCtor?: typeof WebSocket;
}

export function useChatStream(options: UseChatStreamOptions = {}) {
  const session = useSession();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ChatStatus>("idle");
  const socketRef = useRef<WebSocket | null>(null);

  const url = useMemo(() => {
    if (!session.serverUrl || !session.apiBearer) return null;
    const base = session.serverUrl.replace(/^http/, "ws").replace(/\/$/, "");
    return `${base}/ws?token=${encodeURIComponent(session.apiBearer)}`;
  }, [session.serverUrl, session.apiBearer]);

  // Open / close lifecycle
  useEffect(() => {
    if (!url) {
      setStatus("idle");
      return;
    }
    const Ctor = options.webSocketCtor ?? (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    if (!Ctor) {
      setStatus("error");
      return;
    }
    setStatus("connecting");
    const ws = new Ctor(url);
    socketRef.current = ws;

    ws.onopen = () => setStatus("open");
    ws.onclose = () => setStatus("closed");
    ws.onerror = () => setStatus("error");
    ws.onmessage = (e: MessageEvent) => {
      let frame: IncomingFrame;
      try {
        frame = JSON.parse(String(e.data)) as IncomingFrame;
      } catch {
        return;
      }
      if (frame.type === "status") return;
      if ((frame.type === "message" || frame.type === "response") && typeof frame.text === "string") {
        const text = frame.text;
        setMessages((prev) => {
          // If the last message is a streaming assistant, append to it
          const last = prev[prev.length - 1];
          if (last && last.role === "assistant" && last.streaming) {
            const next = prev.slice(0, -1);
            next.push({ ...last, text: last.text + text, streaming: frame.final !== true });
            return next;
          }
          return [
            ...prev,
            {
              id: randomId(),
              role: "assistant",
              text,
              streaming: frame.final !== true,
              createdAt: new Date().toISOString(),
            },
          ];
        });
      }
    };

    return () => {
      ws.onopen = null;
      ws.onclose = null;
      ws.onerror = null;
      ws.onmessage = null;
      if (ws.readyState === 0 || ws.readyState === 1) ws.close();
      socketRef.current = null;
    };
  }, [url, options.webSocketCtor]);

  const send = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return false;
    const ws = socketRef.current;
    if (!ws || ws.readyState !== 1) return false;
    const frame: OutboundFrame = { type: "message", text: trimmed };
    ws.send(JSON.stringify(frame));
    setMessages((prev) => [
      ...prev,
      { id: randomId(), role: "user", text: trimmed, createdAt: new Date().toISOString() },
    ]);
    return true;
  }, []);

  const clear = useCallback(() => setMessages([]), []);

  return { messages, status, send, clear };
}
