import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Bot, Context } from 'grammy';
import { TelegramBridge } from '../src/telegram.js';
import type { IncomingMessage } from '../src/types.js';

class FakeBot {
  private listeners = new Map<string, Array<(ctx: Context) => void | Promise<void>>>();
  private catchHandler: ((err: unknown) => void) | undefined;
  start = vi.fn(async () => undefined);
  stop = vi.fn(async () => undefined);
  api = {
    sendMessage: vi.fn(async () => ({ message_id: 1 })),
  };

  on(event: string, handler: (ctx: Context) => void | Promise<void>): void {
    const list = this.listeners.get(event) ?? [];
    list.push(handler);
    this.listeners.set(event, list);
  }

  catch(h: (err: unknown) => void): void {
    this.catchHandler = h;
  }

  async emit(event: string, ctx: Context): Promise<void> {
    const list = this.listeners.get(event);
    if (!list) return;
    for (const h of list) {
      try {
        await h(ctx);
      } catch (err) {
        this.catchHandler?.(err);
      }
    }
  }
}

let fake: FakeBot;
let bridge: TelegramBridge;

beforeEach(() => {
  fake = new FakeBot();
  bridge = new TelegramBridge({
    token: 'injected',
    bot: fake as unknown as Bot,
    adminUserIds: ['100'],
  });
});

afterEach(async () => {
  await bridge.disconnect();
});

describe('TelegramBridge', () => {
  it('connect registers listeners and starts polling', async () => {
    await bridge.connect();
    expect(bridge.isConnected()).toBe(true);
    expect(fake.start).toHaveBeenCalled();
  });

  it('text message → IncomingMessage', async () => {
    await bridge.connect();
    const handler = vi.fn<(m: IncomingMessage) => void>();
    bridge.onMessage(handler);

    const ctx = {
      message: {
        message_id: 42,
        date: 1_700_000_000,
        text: 'hello',
        chat: { id: 555, type: 'private' },
      },
      from: { id: 100, username: 'alice', first_name: 'Alice' },
      chat: { id: 555, type: 'private' },
    } as unknown as Context;

    await fake.emit('message:text', ctx);

    expect(handler).toHaveBeenCalledOnce();
    const msg = handler.mock.calls[0]![0];
    expect(msg.text).toBe('hello');
    expect(msg.platform).toBe('telegram');
    expect(msg.user).toMatchObject({ id: '100', name: 'alice', isAdmin: true });
    expect(msg.channel).toMatchObject({ id: '555', isDM: true });
  });

  it('callback query → IncomingMessage with frameType=callback_query', async () => {
    await bridge.connect();
    const handler = vi.fn<(m: IncomingMessage) => void>();
    bridge.onMessage(handler);

    const answerCallbackQuery = vi.fn(async () => undefined);
    const ctx = {
      callbackQuery: { id: 'cb1', data: 'approve' },
      from: { id: 101, username: 'bob' },
      chat: { id: 555, type: 'private' },
      answerCallbackQuery,
    } as unknown as Context;

    await fake.emit('callback_query:data', ctx);

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0].text).toBe('approve');
    expect(handler.mock.calls[0]![0].platformData?.frameType).toBe('callback_query');
    expect(answerCallbackQuery).toHaveBeenCalled();
  });

  it('send() posts message via api.sendMessage', async () => {
    await bridge.connect();
    await bridge.send('555', { text: 'hi' });
    expect(fake.api.sendMessage).toHaveBeenCalledWith('555', 'hi', expect.any(Object));
  });

  it('send() with buttons builds inline keyboard', async () => {
    await bridge.connect();
    await bridge.send('555', {
      text: 'pick',
      buttons: [
        { label: 'Yes', value: 'y' },
        { label: 'No', value: 'n' },
      ],
    });
    const args = fake.api.sendMessage.mock.calls[0]!;
    expect(args[2]).toHaveProperty('reply_markup');
  });

  it('send() pre-connect throws', async () => {
    await expect(bridge.send('x', { text: 'y' })).rejects.toThrow(/not connected/i);
  });

  it('getCapabilities surface', () => {
    const c = bridge.getCapabilities();
    expect(c.files).toBe(true);
    expect(c.threads).toBe(false);
    expect(c.maxMessageBytes).toBe(4096);
  });
});
