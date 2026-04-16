import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useWebSocket } from '../../src/hooks/useWebSocket.js';

interface Listeners {
  open?: () => void;
  message?: (e: { data: string }) => void;
  close?: () => void;
  error?: () => void;
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  readyState = 0;
  listeners: Listeners = {};
  sent: string[] = [];
  constructor(public readonly url: string) {
    FakeWebSocket.instances.push(this);
  }
  addEventListener(evt: string, fn: (...args: unknown[]) => void): void {
    (this.listeners as Record<string, unknown>)[evt] = fn;
  }
  send(d: string): void {
    this.sent.push(d);
  }
  close(): void {
    this.readyState = 3;
    this.listeners.close?.();
  }
  open(): void {
    this.readyState = 1;
    this.listeners.open?.();
  }
  recv(d: string): void {
    this.listeners.message?.({ data: d });
  }
}

describe('useWebSocket', () => {
  it('connects immediately and reports connecting status', () => {
    FakeWebSocket.instances = [];
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://test',
        webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      }),
    );
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(result.current.status).toBe('connecting');
  });

  it('reports open status after open event', () => {
    FakeWebSocket.instances = [];
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://test',
        webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      }),
    );
    act(() => FakeWebSocket.instances[0]!.open());
    expect(result.current.status).toBe('open');
  });

  it('parses JSON messages by default', () => {
    FakeWebSocket.instances = [];
    const { result } = renderHook(() =>
      useWebSocket<{ a: number }>({
        url: 'ws://test',
        webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      }),
    );
    act(() => {
      FakeWebSocket.instances[0]!.open();
      FakeWebSocket.instances[0]!.recv(JSON.stringify({ a: 1 }));
      FakeWebSocket.instances[0]!.recv(JSON.stringify({ a: 2 }));
    });
    expect(result.current.messages).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('drops unparseable frames silently', () => {
    FakeWebSocket.instances = [];
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://test',
        webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      }),
    );
    act(() => {
      FakeWebSocket.instances[0]!.open();
      FakeWebSocket.instances[0]!.recv('not json {');
    });
    expect(result.current.messages).toEqual([]);
  });

  it('send serializes objects to JSON when socket is open', () => {
    FakeWebSocket.instances = [];
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://test',
        webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      }),
    );
    act(() => FakeWebSocket.instances[0]!.open());
    act(() => result.current.send({ hello: 'world' }));
    expect(FakeWebSocket.instances[0]!.sent).toEqual([JSON.stringify({ hello: 'world' })]);
  });

  it('send is a no-op when socket is not open', () => {
    FakeWebSocket.instances = [];
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://test',
        webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      }),
    );
    act(() => result.current.send('pre-open'));
    expect(FakeWebSocket.instances[0]!.sent).toEqual([]);
  });

  it('clear() empties the message buffer', () => {
    FakeWebSocket.instances = [];
    const { result } = renderHook(() =>
      useWebSocket({
        url: 'ws://test',
        webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      }),
    );
    act(() => {
      FakeWebSocket.instances[0]!.open();
      FakeWebSocket.instances[0]!.recv(JSON.stringify({ x: 1 }));
    });
    act(() => result.current.clear());
    expect(result.current.messages).toEqual([]);
  });

  it('closes the socket on unmount', () => {
    FakeWebSocket.instances = [];
    const { unmount } = renderHook(() =>
      useWebSocket({
        url: 'ws://test',
        webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      }),
    );
    unmount();
    expect(FakeWebSocket.instances[0]!.readyState).toBe(3);
  });

  it('null url skips connection', () => {
    FakeWebSocket.instances = [];
    const { result } = renderHook(() =>
      useWebSocket({
        url: null,
        webSocketCtor: FakeWebSocket as unknown as typeof WebSocket,
      }),
    );
    expect(FakeWebSocket.instances).toHaveLength(0);
    expect(result.current.status).toBe('closed');
  });
});
