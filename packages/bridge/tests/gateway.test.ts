import type { AgentResponse, HandleMessageRequest } from '@openhipp0/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { Gateway } from '../src/gateway.js';
import { WebBridge } from '../src/web.js';
import type {
  ErrorHandler,
  IncomingMessage,
  MessageBridge,
  MessageHandler,
  OutgoingMessage,
} from '../src/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Programmable fake bridge — emit + capture send
// ─────────────────────────────────────────────────────────────────────────────

class FakeBridge implements MessageBridge {
  readonly platform = 'cli' as const;
  private connected = false;
  private handlers: MessageHandler[] = [];
  private errorHandlers: ErrorHandler[] = [];
  readonly sends: Array<{ channelId: string; content: OutgoingMessage }> = [];

  async connect(): Promise<void> {
    this.connected = true;
  }
  async disconnect(): Promise<void> {
    this.connected = false;
  }
  isConnected(): boolean {
    return this.connected;
  }
  onMessage(h: MessageHandler): void {
    this.handlers.push(h);
  }
  onError(h: ErrorHandler): void {
    this.errorHandlers.push(h);
  }
  async send(channelId: string, content: OutgoingMessage): Promise<void> {
    this.sends.push({ channelId, content });
  }
  getCapabilities(): {
    files: boolean;
    buttons: boolean;
    threads: boolean;
    slashCommands: boolean;
    maxMessageBytes: number;
  } {
    return {
      files: false,
      buttons: false,
      threads: false,
      slashCommands: false,
      maxMessageBytes: 4000,
    };
  }
  async emit(msg: IncomingMessage): Promise<void> {
    for (const h of this.handlers) await h(msg);
  }
  emitError(err: unknown): void {
    for (const h of this.errorHandlers) h(err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scripted agent
// ─────────────────────────────────────────────────────────────────────────────

function scriptedAgent(reply: (req: HandleMessageRequest) => string): {
  handleMessage: ReturnType<typeof vi.fn>;
} {
  return {
    handleMessage: vi.fn(async (req: HandleMessageRequest): Promise<AgentResponse> => {
      return {
        text: reply(req),
        messages: [],
        iterations: 1,
        toolCallsCount: 0,
        tokensUsed: { input: 10, output: 5 },
        finalStopReason: 'end_turn',
        stoppedReason: 'end_turn',
        startedAt: 0,
        finishedAt: 0,
      };
    }),
  };
}

function incoming(overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    platform: 'cli',
    id: `m_${Math.random().toString(36).slice(2, 8)}`,
    channel: { id: 'c1', isDM: true },
    user: { id: 'u1', name: 'alice' },
    text: 'hello',
    timestamp: Date.now(),
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('Gateway: routing', () => {
  let fake: FakeBridge;
  let gw: Gateway;

  beforeEach(() => {
    fake = new FakeBridge();
  });
  afterEach(async () => {
    await gw.stop();
  });

  it('start() connects every bridge', async () => {
    gw = new Gateway({
      bridges: [fake],
      agent: scriptedAgent(() => 'response'),
    });
    expect(fake.isConnected()).toBe(false);
    await gw.start();
    expect(fake.isConnected()).toBe(true);
  });

  it('routes an incoming message through the agent and sends the reply', async () => {
    const agent = scriptedAgent((req) => `echo: ${req.message}`);
    gw = new Gateway({ bridges: [fake], agent });
    await gw.start();

    await fake.emit(incoming({ text: 'hi there' }));

    expect(agent.handleMessage).toHaveBeenCalledOnce();
    expect(agent.handleMessage.mock.calls[0]![0].message).toBe('hi there');
    expect(fake.sends).toHaveLength(1);
    expect(fake.sends[0]!.content.text).toBe('echo: hi there');
    expect(fake.sends[0]!.content.replyTo).toBeDefined();
  });

  it('tracks conversation across turns within a session', async () => {
    const agent = scriptedAgent((req) => `[prev=${req.conversation?.length ?? 0}] ${req.message}`);
    gw = new Gateway({ bridges: [fake], agent });
    await gw.start();

    await fake.emit(incoming({ id: 'm1', text: 'one' }));
    await fake.emit(incoming({ id: 'm2', text: 'two' }));
    await fake.emit(incoming({ id: 'm3', text: 'three' }));

    // Each handler call should see the growing conversation
    expect(agent.handleMessage.mock.calls[0]![0].conversation?.length).toBe(0);
    expect(agent.handleMessage.mock.calls[1]![0].conversation?.length).toBe(2);
    expect(agent.handleMessage.mock.calls[2]![0].conversation?.length).toBe(4);
  });

  it('keeps sessions distinct across (user, channel)', async () => {
    const agent = scriptedAgent((req) => `prev=${req.conversation?.length ?? 0}`);
    gw = new Gateway({ bridges: [fake], agent });
    await gw.start();

    await fake.emit(incoming({ user: { id: 'u1', name: 'a' }, id: 'm1' }));
    await fake.emit(incoming({ user: { id: 'u2', name: 'b' }, id: 'm2' }));

    expect(agent.handleMessage.mock.calls[0]![0].conversation?.length).toBe(0);
    expect(agent.handleMessage.mock.calls[1]![0].conversation?.length).toBe(0);
    expect(gw.listSessions()).toHaveLength(2);
  });

  it('caps session buffer at sessionBufferSize', async () => {
    const agent = scriptedAgent(() => 'ok');
    gw = new Gateway({
      bridges: [fake],
      agent,
      sessionBufferSize: 4, // should keep last 4 entries
    });
    await gw.start();
    for (let i = 0; i < 10; i++) {
      await fake.emit(incoming({ id: `m${i}`, text: `msg-${i}` }));
    }
    // The agent sees the conversation before it appends — last call should
    // see at most 4 entries (the buffer cap).
    const lastCall = agent.handleMessage.mock.calls[agent.handleMessage.mock.calls.length - 1]!;
    expect(lastCall[0].conversation?.length).toBeLessThanOrEqual(4);
  });

  it('rejects non-admin users in admin-only channels', async () => {
    const agent = scriptedAgent(() => 'ok');
    const onError = vi.fn();
    gw = new Gateway({
      bridges: [fake],
      agent,
      requireAdminChannels: ['c1'],
      onError,
    });
    await gw.start();
    await fake.emit(incoming({ user: { id: 'u1', name: 'a', isAdmin: false } }));
    expect(agent.handleMessage).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledOnce();
    expect(fake.sends).toHaveLength(0);
  });

  it('admin users can post in admin-only channels', async () => {
    const agent = scriptedAgent(() => 'ok');
    gw = new Gateway({
      bridges: [fake],
      agent,
      requireAdminChannels: ['c1'],
    });
    await gw.start();
    await fake.emit(incoming({ user: { id: 'u1', name: 'a', isAdmin: true } }));
    expect(agent.handleMessage).toHaveBeenCalledOnce();
  });

  it('agent errors route through onError and do NOT send a reply', async () => {
    const onError = vi.fn();
    const brokenAgent = {
      handleMessage: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    gw = new Gateway({ bridges: [fake], agent: brokenAgent, onError });
    await gw.start();
    await fake.emit(incoming());
    expect(onError).toHaveBeenCalledOnce();
    expect(fake.sends).toHaveLength(0);
  });

  it('send() errors route through onError without disrupting the gateway', async () => {
    const onError = vi.fn();
    const flakyBridge = new FakeBridge();
    vi.spyOn(flakyBridge, 'send').mockRejectedValue(new Error('send down'));
    gw = new Gateway({ bridges: [flakyBridge], agent: scriptedAgent(() => 'ok'), onError });
    await gw.start();
    await flakyBridge.emit(incoming());
    expect(onError).toHaveBeenCalledOnce();
  });

  it('bridge.onError is wired to gateway.onError', async () => {
    const onError = vi.fn();
    gw = new Gateway({ bridges: [fake], agent: scriptedAgent(() => 'ok'), onError });
    await gw.start();
    fake.emitError(new Error('bridge side blew up'));
    expect(onError).toHaveBeenCalledOnce();
  });

  it('onExchange fires for each routed message', async () => {
    const onExchange = vi.fn();
    gw = new Gateway({
      bridges: [fake],
      agent: scriptedAgent(() => 'ok'),
      onExchange,
    });
    await gw.start();
    await fake.emit(incoming({ id: 'abc', text: 'hello' }));
    expect(onExchange).toHaveBeenCalledOnce();
    expect(onExchange.mock.calls[0]![0]).toMatchObject({
      platform: 'cli',
      inboundId: 'abc',
      inboundText: 'hello',
      outboundText: 'ok',
    });
  });

  it('getBridge returns the bridge for a platform', async () => {
    gw = new Gateway({ bridges: [fake], agent: scriptedAgent(() => 'ok') });
    await gw.start();
    expect(gw.getBridge('cli')).toBe(fake);
    expect(gw.getBridge('discord')).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end with real WebBridge
// ─────────────────────────────────────────────────────────────────────────────

describe('Gateway + WebBridge (integration)', () => {
  let web: WebBridge;
  let gw: Gateway;
  let port: number;

  beforeEach(async () => {
    web = new WebBridge({ port: 0, host: '127.0.0.1' });
    gw = new Gateway({
      bridges: [web],
      agent: scriptedAgent((req) => `agent says: ${req.message.toUpperCase()}`),
    });
    await gw.start();
    const anyBridge = web as unknown as { httpServer: { address(): { port: number } } };
    port = anyBridge.httpServer.address().port;
  });

  afterEach(async () => {
    await gw.stop();
  });

  it('full loop: WS client sends → gateway routes → agent replies → client receives', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', reject);
    });
    const frames: Record<string, unknown>[] = [];
    ws.on('message', (data) => {
      frames.push(JSON.parse(data.toString('utf8')) as Record<string, unknown>);
    });
    await new Promise((r) => setTimeout(r, 30));
    ws.send(JSON.stringify({ type: 'message', id: 'm1', text: 'hello gateway' }));
    await new Promise((r) => setTimeout(r, 120));
    ws.close();

    const responses = frames.filter((f) => f.type === 'response');
    expect(responses).toHaveLength(1);
    expect(responses[0]!.text).toBe('agent says: HELLO GATEWAY');
    expect(responses[0]!.replyTo).toBe('m1');
  });
});
