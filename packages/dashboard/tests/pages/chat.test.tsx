import { describe, it, expect } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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
});
