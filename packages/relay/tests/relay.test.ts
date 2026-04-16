import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import { RelayServer, MemoryCredentialStore, hashToken } from '../src/index.js';

/** WebSocket wrapper that buffers incoming frames so awaits can't race the stream. */
interface Client {
  ws: WebSocket;
  next(timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): void;
}

async function connect(url: string): Promise<Client> {
  const ws = new WebSocket(url);
  const queue: Record<string, unknown>[] = [];
  const waiters: ((v: Record<string, unknown>) => void)[] = [];
  ws.on('message', (raw: RawData) => {
    const frame = JSON.parse(raw.toString()) as Record<string, unknown>;
    const w = waiters.shift();
    if (w) w(frame);
    else queue.push(frame);
  });
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', reject);
    ws.once('close', (code) => {
      if (code !== 1000 && waiters.length === 0 && queue.length === 0) reject(new Error(`closed ${code}`));
    });
  });
  return {
    ws,
    next: (timeoutMs = 2000) => {
      if (queue.length > 0) return Promise.resolve(queue.shift()!);
      return new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
        waiters.push((v) => {
          clearTimeout(timer);
          resolve(v);
        });
      });
    },
    close: () => ws.close(),
  };
}

async function expectCloseCode(url: string): Promise<number> {
  const ws = new WebSocket(url);
  return new Promise<number>((resolve) => {
    ws.once('close', (code) => resolve(code));
    ws.once('error', () => resolve(1006));
  });
}

describe('RelayServer', () => {
  let relay: RelayServer;
  let port: number;

  beforeEach(async () => {
    const creds = new MemoryCredentialStore();
    await creds.put({ clientId: 'server', tokenSha256: hashToken('srv-token') });
    await creds.put({ clientId: 'mobile', tokenSha256: hashToken('mbl-token') });

    port = 31000 + Math.floor(Math.random() * 2000);
    relay = new RelayServer({ port, credentials: creds });
    await relay.listen();
  });

  afterEach(async () => {
    await relay.close();
  });

  it('rejects unauthenticated connections', async () => {
    const code = await expectCloseCode(`ws://127.0.0.1:${port}/?clientId=unknown&token=nope`);
    expect(code).toBe(1008);
  });

  it('admits authenticated client and sends hello', async () => {
    const c = await connect(`ws://127.0.0.1:${port}/?clientId=server&token=srv-token`);
    const hello = await c.next();
    expect(hello).toEqual({ type: 'hello', clientId: 'server' });
    c.close();
  });

  it('routes envelope between two live clients', async () => {
    const server = await connect(`ws://127.0.0.1:${port}/?clientId=server&token=srv-token`);
    const mobile = await connect(`ws://127.0.0.1:${port}/?clientId=mobile&token=mbl-token`);
    await server.next(); // drain hello
    await mobile.next(); // drain hello

    server.ws.send(
      JSON.stringify({
        type: 'envelope',
        to: 'mobile',
        from: 'server',
        payload: 'opaque-ciphertext',
        msgId: 'msg-1',
      }),
    );

    const received = await mobile.next();
    expect(received).toMatchObject({
      type: 'envelope',
      from: 'server',
      to: 'mobile',
      payload: 'opaque-ciphertext',
      msgId: 'msg-1',
    });

    server.close();
    mobile.close();
  });

  it('buffers envelopes for offline recipient + delivers on reconnect', async () => {
    const server = await connect(`ws://127.0.0.1:${port}/?clientId=server&token=srv-token`);
    await server.next(); // drain hello

    server.ws.send(
      JSON.stringify({
        type: 'envelope',
        to: 'mobile',
        from: 'server',
        payload: 'queued',
        msgId: 'msg-2',
      }),
    );
    // Give the relay a moment to buffer
    await new Promise((r) => setTimeout(r, 50));

    const mobile = await connect(`ws://127.0.0.1:${port}/?clientId=mobile&token=mbl-token`);
    await mobile.next(); // hello
    const delivered = await mobile.next();
    expect(delivered).toMatchObject({
      type: 'envelope',
      from: 'server',
      payload: 'queued',
      msgId: 'msg-2',
    });

    server.close();
    mobile.close();
  });

  it('rejects a frame where from != authenticated clientId', async () => {
    const c = await connect(`ws://127.0.0.1:${port}/?clientId=server&token=srv-token`);
    await c.next(); // hello
    c.ws.send(
      JSON.stringify({
        type: 'envelope',
        to: 'mobile',
        from: 'IMPOSTOR',
        payload: 'x',
        msgId: 'msg-3',
      }),
    );
    const err = await c.next();
    expect(err).toEqual({ type: 'error', code: 'sender-mismatch' });
    c.close();
  });
});
