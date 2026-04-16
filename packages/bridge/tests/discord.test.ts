import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'discord.js';
import { DiscordBridge } from '../src/discord.js';
import type { IncomingMessage } from '../src/types.js';

interface FakeChannel {
  id: string;
  send: ReturnType<typeof vi.fn>;
}

class FakeDiscordClient extends EventEmitter {
  readonly user = { id: 'bot:self' };
  readonly channels = {
    fetch: vi.fn(async (id: string) => this.channelMap.get(id)),
  };
  login = vi.fn(async () => 'ok');
  destroy = vi.fn(async () => undefined);
  private channelMap = new Map<string, FakeChannel>();

  addChannel(id: string): FakeChannel {
    const ch: FakeChannel = { id, send: vi.fn(async () => undefined) };
    this.channelMap.set(id, ch);
    return ch;
  }
}

let fake: FakeDiscordClient;
let bridge: DiscordBridge;

beforeEach(() => {
  fake = new FakeDiscordClient();
  bridge = new DiscordBridge({
    token: 'injected',
    client: fake as unknown as Client,
    adminUserIds: ['alice'],
  });
});

afterEach(async () => {
  await bridge.disconnect();
});

describe('DiscordBridge', () => {
  it('connect / isConnected / disconnect', async () => {
    expect(bridge.isConnected()).toBe(false);
    await bridge.connect();
    expect(bridge.isConnected()).toBe(true);
    expect(fake.login).toHaveBeenCalledOnce();
    await bridge.disconnect();
    expect(bridge.isConnected()).toBe(false);
    expect(fake.destroy).toHaveBeenCalledOnce();
  });

  it('messageCreate → IncomingMessage (skips own bot messages)', async () => {
    await bridge.connect();
    const handler = vi.fn<(m: IncomingMessage) => void>();
    bridge.onMessage(handler);

    // Own bot: should be ignored
    fake.emit('messageCreate', {
      id: 'm1',
      author: { id: 'bot:self', username: 'bot' },
      channel: { id: 'c1' },
      channelId: 'c1',
      guild: null,
      guildId: null,
      content: 'hi from self',
      createdTimestamp: 123,
      attachments: new Map(),
      reference: null,
    });
    expect(handler).not.toHaveBeenCalled();

    // Real user: fires
    fake.emit('messageCreate', {
      id: 'm2',
      author: { id: 'alice', username: 'alice' },
      channel: { id: 'c1' },
      channelId: 'c1',
      guild: { name: 'Guild' },
      guildId: 'g1',
      content: 'hello',
      createdTimestamp: 456,
      attachments: new Map([
        ['a1', { name: 'file.png', contentType: 'image/png', size: 1234, url: 'https://x/f.png' }],
      ]),
      reference: { messageId: 'parent1' },
    });
    expect(handler).toHaveBeenCalledOnce();
    const msg = handler.mock.calls[0]![0];
    expect(msg.text).toBe('hello');
    expect(msg.user).toMatchObject({ id: 'alice', isAdmin: true });
    expect(msg.replyTo).toBe('parent1');
    expect(msg.attachments).toHaveLength(1);
    expect(msg.attachments?.[0]!.url).toBe('https://x/f.png');
  });

  it('send() fetches channel and posts content', async () => {
    await bridge.connect();
    const ch = fake.addChannel('c1');
    await bridge.send('c1', { text: 'hi' });
    expect(fake.channels.fetch).toHaveBeenCalledWith('c1');
    expect(ch.send).toHaveBeenCalledOnce();
    const payload = ch.send.mock.calls[0]![0] as { content: string };
    expect(payload.content).toBe('hi');
  });

  it('send() with buttons builds an ActionRow', async () => {
    await bridge.connect();
    const ch = fake.addChannel('c1');
    await bridge.send('c1', {
      text: 'pick',
      buttons: [
        { label: 'Yes', value: 'y', style: 'primary' },
        { label: 'No', value: 'n', style: 'danger' },
      ],
    });
    const payload = ch.send.mock.calls[0]![0] as { components?: unknown[] };
    expect(payload.components).toBeDefined();
    expect(payload.components).toHaveLength(1);
  });

  it('send() pre-connect throws Hipp0BridgeNotConnectedError', async () => {
    await expect(bridge.send('c1', { text: 'x' })).rejects.toThrow(/not connected/i);
  });

  it('send() to unknown channel throws Hipp0BridgeSendError', async () => {
    await bridge.connect();
    await expect(bridge.send('missing', { text: 'x' })).rejects.toThrow(/send failed/i);
  });

  it('getCapabilities advertises full feature set', () => {
    const c = bridge.getCapabilities();
    expect(c.files).toBe(true);
    expect(c.buttons).toBe(true);
    expect(c.threads).toBe(true);
    expect(c.slashCommands).toBe(true);
  });
});
