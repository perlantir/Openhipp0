import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { WebBridge } from '../src/web.js';
import type { IncomingMessage } from '../src/types.js';

let bridge: WebBridge;
let port: number;

async function openClient(): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
  });
  // Tiny wait so the server has time to register the connection + send the
  // initial 'status' frame, which individual tests can ignore or filter.
  await new Promise((r) => setTimeout(r, 30));
  return ws;
}

beforeEach(async () => {
  // Ephemeral port — use 0 and let the OS pick
  bridge = new WebBridge({ port: 0, host: '127.0.0.1' });
  await bridge.connect();
  // Grab the actual port from the underlying server
  // `connect()` passed opts.port=0 to listen() — read it back via the server
  // reference which the bridge holds privately; easier: iterate open sockets
  // after first connect. Instead expose a getter? Add one inline via any-cast.
  const anyBridge = bridge as unknown as { httpServer: { address(): { port: number } } };
  port = anyBridge.httpServer.address().port;
});

afterEach(async () => {
  await bridge.disconnect();
});

describe('WebBridge', () => {
  it('connect / disconnect toggle isConnected', async () => {
    expect(bridge.isConnected()).toBe(true);
    await bridge.disconnect();
    expect(bridge.isConnected()).toBe(false);
  });

  it('incoming {type:"message", text} becomes IncomingMessage', async () => {
    const handler = vi.fn<(msg: IncomingMessage) => void>();
    bridge.onMessage(handler);
    const ws = await openClient();
    ws.send(JSON.stringify({ type: 'message', id: 'm1', text: 'hello from client' }));
    // Wait for server-side handler to fire.
    await new Promise((r) => setTimeout(r, 50));
    ws.close();

    expect(handler).toHaveBeenCalled();
    const msg = handler.mock.calls[0]![0];
    expect(msg.text).toBe('hello from client');
    expect(msg.platform).toBe('web');
    // Server assigns the authoritative id — client id is kept as clientRef.
    expect(msg.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(msg.platformData?.clientRef).toBe('m1');
  });

  it('rejects cross-origin WS upgrade when allowedOrigins is set', async () => {
    await bridge.disconnect();
    const originBridge = new WebBridge({
      port: 0,
      host: '127.0.0.1',
      allowedOrigins: ['http://127.0.0.1:5173'],
      allowAnonymous: true,
    });
    await originBridge.connect();
    const p = (originBridge as unknown as { httpServer: { address(): { port: number } } })
      .httpServer.address().port;

    const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`, { headers: { Origin: 'https://evil.example' } });
    await new Promise<void>((resolve) => {
      ws.once('error', () => resolve());
      ws.once('close', () => resolve());
    });
    expect(ws.readyState).not.toBe(WebSocket.OPEN);
    await originBridge.disconnect();
  });

  it('accepts allowed Origin via allowlist', async () => {
    await bridge.disconnect();
    const originBridge = new WebBridge({
      port: 0,
      host: '127.0.0.1',
      allowedOrigins: ['http://127.0.0.1:5173'],
      allowAnonymous: true,
    });
    await originBridge.connect();
    const p = (originBridge as unknown as { httpServer: { address(): { port: number } } })
      .httpServer.address().port;

    const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`, {
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    expect(ws.readyState).toBe(WebSocket.OPEN);
    ws.close();
    await originBridge.disconnect();
  });

  it('safe-by-default: rejects upgrade when allowedOrigins set + no authenticator + allowAnonymous=false', async () => {
    await bridge.disconnect();
    const strictBridge = new WebBridge({
      port: 0,
      host: '127.0.0.1',
      allowedOrigins: ['http://127.0.0.1:5173'],
      // allowAnonymous defaults to false because allowedOrigins is non-empty
    });
    await strictBridge.connect();
    const p = (strictBridge as unknown as { httpServer: { address(): { port: number } } })
      .httpServer.address().port;

    const ws = new WebSocket(`ws://127.0.0.1:${p}/ws`, {
      headers: { Origin: 'http://127.0.0.1:5173' },
    });
    const closeCode = await new Promise<number>((resolve) => {
      ws.once('close', (code) => resolve(code));
      ws.once('error', () => resolve(-1));
    });
    expect(closeCode).toBe(4401);
    await strictBridge.disconnect();
  });

  it('send({text}) delivers a response frame to the correct channel', async () => {
    bridge.onMessage(async (m) => {
      await bridge.send(m.channel.id, { text: `echo: ${m.text}` });
    });
    const ws = await openClient();
    const frames: Record<string, unknown>[] = [];
    ws.on('message', (data) => {
      frames.push(JSON.parse(data.toString('utf8')) as Record<string, unknown>);
    });
    ws.send(JSON.stringify({ type: 'message', id: 'm1', text: 'ping' }));
    await new Promise((r) => setTimeout(r, 80));
    ws.close();
    const responses = frames.filter((f) => f.type === 'response');
    expect(responses).toHaveLength(1);
    expect(responses[0]!.text).toBe('echo: ping');
  });

  it('button frames produce IncomingMessage with button value as text', async () => {
    const handler = vi.fn<(msg: IncomingMessage) => void>();
    bridge.onMessage(handler);
    const ws = await openClient();
    ws.send(JSON.stringify({ type: 'button', parentId: 'p1', buttonValue: 'yes' }));
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0]![0].text).toBe('yes');
    expect(handler.mock.calls[0]![0].platformData?.frameType).toBe('button');
  });

  it('send to unknown channel throws Hipp0BridgeNotConnectedError', async () => {
    await expect(bridge.send('never', { text: 'x' })).rejects.toThrow(/Bridge not connected/);
  });

  it('rejects unauthenticated connections when authenticate returns null', async () => {
    await bridge.disconnect();
    const authBridge = new WebBridge({
      port: 0,
      host: '127.0.0.1',
      authenticate: () => null,
    });
    await authBridge.connect();
    const server = (authBridge as unknown as { httpServer: { address(): { port: number } } })
      .httpServer;
    const authPort = server.address().port;

    const ws = new WebSocket(`ws://127.0.0.1:${authPort}/ws`);
    const closed = await new Promise<number>((resolve) => {
      ws.once('close', (code) => resolve(code));
    });
    expect(closed).toBe(4401);
    await authBridge.disconnect();
  });

  it('openChannels reflects connected clients', async () => {
    expect(bridge.openChannels()).toHaveLength(0);
    const ws = await openClient();
    expect(bridge.openChannels()).toHaveLength(1);
    ws.close();
    await new Promise((r) => setTimeout(r, 50));
    expect(bridge.openChannels()).toHaveLength(0);
  });

  it('getCapabilities advertises file + button support', () => {
    const c = bridge.getCapabilities();
    expect(c.files).toBe(true);
    expect(c.buttons).toBe(true);
    expect(c.threads).toBe(false);
  });
});
