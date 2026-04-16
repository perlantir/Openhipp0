import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Chat } from '../../src/pages/Chat.js';

// Minimal fake WebSocket — tracks lifecycle + allows tests to drive messages.
interface FakeListeners {
  open?: () => void;
  close?: () => void;
  error?: () => void;
  message?: (e: { data: string }) => void;
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readonly url: string;
  readyState = 0;
  listeners: FakeListeners = {};
  sentFrames: string[] = [];
  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }
  addEventListener(evt: string, fn: (...args: unknown[]) => void): void {
    (this.listeners as Record<string, unknown>)[evt] = fn;
  }
  send(data: string): void {
    this.sentFrames.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.listeners.close?.();
  }
  simulateOpen(): void {
    this.readyState = 1;
    this.listeners.open?.();
  }
  simulateMessage(data: string): void {
    this.listeners.message?.({ data });
  }
}

describe('Chat page', () => {
  it('renders chat log and connects via injected WebSocket', () => {
    FakeWebSocket.instances = [];
    render(
      <MemoryRouter>
        <Chat
          url="ws://test/ws"
          webSocketCtor={FakeWebSocket as unknown as typeof WebSocket}
        />
      </MemoryRouter>,
    );
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0]!.url).toBe('ws://test/ws');
    expect(screen.getByTestId('ws-status').textContent).toBe('connecting');
  });

  it('flips status to "open" on socket open', () => {
    FakeWebSocket.instances = [];
    render(
      <MemoryRouter>
        <Chat
          url="ws://test/ws"
          webSocketCtor={FakeWebSocket as unknown as typeof WebSocket}
        />
      </MemoryRouter>,
    );
    act(() => {
      FakeWebSocket.instances[0]!.simulateOpen();
    });
    expect(screen.getByTestId('ws-status').textContent).toBe('open');
  });

  it('appends incoming messages to the chat log', () => {
    FakeWebSocket.instances = [];
    render(
      <MemoryRouter>
        <Chat
          url="ws://test/ws"
          webSocketCtor={FakeWebSocket as unknown as typeof WebSocket}
        />
      </MemoryRouter>,
    );
    act(() => {
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateMessage(
        JSON.stringify({ type: 'response', content: 'hello back', from: 'agent' }),
      );
    });
    expect(screen.getByTestId('chat-log').textContent).toContain('hello back');
  });

  it('thumbs-up on an assistant turn POSTs to /api/feedback with rating=1', async () => {
    FakeWebSocket.instances = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ ok: true })));
    render(
      <MemoryRouter>
        <Chat
          url="ws://test/ws"
          webSocketCtor={FakeWebSocket as unknown as typeof WebSocket}
          fetchImpl={fetchImpl as unknown as typeof fetch}
          projectId="p1"
          userId="tester"
        />
      </MemoryRouter>,
    );
    act(() => {
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateMessage(
        JSON.stringify({ type: 'response', content: 'answer', from: 'agent' }),
      );
    });
    const thumb = await screen.findByTestId('thumb-up-0');
    fireEvent.click(thumb);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    const call = fetchImpl.mock.calls[0]!;
    expect(call[0]).toBe('/api/feedback');
    const body = JSON.parse((call[1]?.body as string) ?? '{}') as {
      projectId: string;
      userId: string;
      rating: number;
      source: string;
    };
    expect(body).toMatchObject({ projectId: 'p1', userId: 'tester', rating: 1, source: 'explicit' });
  });

  it('second click on same thumb toggles rating back to 0', async () => {
    FakeWebSocket.instances = [];
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response('{}'));
    render(
      <MemoryRouter>
        <Chat
          url="ws://test/ws"
          webSocketCtor={FakeWebSocket as unknown as typeof WebSocket}
          fetchImpl={fetchImpl as unknown as typeof fetch}
        />
      </MemoryRouter>,
    );
    act(() => {
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateMessage(
        JSON.stringify({ type: 'response', content: 'x', from: 'agent' }),
      );
    });
    const thumb = await screen.findByTestId('thumb-up-0');
    fireEvent.click(thumb);
    fireEvent.click(thumb);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    const second = JSON.parse((fetchImpl.mock.calls[1]![1]?.body as string) ?? '{}') as {
      rating: number;
    };
    expect(second.rating).toBe(0);
  });

  it('user-turn messages do NOT render thumb buttons', () => {
    FakeWebSocket.instances = [];
    render(
      <MemoryRouter>
        <Chat
          url="ws://test/ws"
          webSocketCtor={FakeWebSocket as unknown as typeof WebSocket}
        />
      </MemoryRouter>,
    );
    act(() => {
      FakeWebSocket.instances[0]!.simulateOpen();
      FakeWebSocket.instances[0]!.simulateMessage(
        JSON.stringify({ type: 'message', content: 'hi', from: 'me' }),
      );
    });
    expect(screen.queryByTestId('thumb-up-0')).toBeNull();
  });
});
