import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { App } from '@slack/bolt';
import { SlackBridge } from '../src/slack.js';
import type { IncomingMessage } from '../src/types.js';

interface MessageHandlerFn {
  (args: unknown): Promise<void>;
}

interface ActionHandlerFn {
  (args: unknown): Promise<void>;
}

class FakeSlackApp {
  private messageHandlers: MessageHandlerFn[] = [];
  private actionHandlers: ActionHandlerFn[] = [];
  private errorHandler: ((err: unknown) => void) | undefined;

  start = vi.fn(async () => ({}));
  stop = vi.fn(async () => undefined);
  client = {
    chat: {
      postMessage: vi.fn(async () => ({ ok: true })),
    },
  };

  message(handler: MessageHandlerFn): void {
    this.messageHandlers.push(handler);
  }

  action(_filter: unknown, handler: ActionHandlerFn): void {
    this.actionHandlers.push(handler);
  }

  error(handler: (err: unknown) => void): void {
    this.errorHandler = handler;
  }

  async emitMessage(event: Record<string, unknown>): Promise<void> {
    for (const h of this.messageHandlers) {
      try {
        await h({ event });
      } catch (err) {
        this.errorHandler?.(err);
      }
    }
  }

  async emitAction(args: Record<string, unknown>): Promise<void> {
    for (const h of this.actionHandlers) {
      try {
        await h(args);
      } catch (err) {
        this.errorHandler?.(err);
      }
    }
  }
}

let fake: FakeSlackApp;
let bridge: SlackBridge;

beforeEach(() => {
  fake = new FakeSlackApp();
  bridge = new SlackBridge({
    botToken: 'xoxb-injected',
    appToken: 'xapp-injected',
    app: fake as unknown as App,
    adminUserIds: ['U-admin'],
  });
});

afterEach(async () => {
  await bridge.disconnect();
});

describe('SlackBridge', () => {
  it('connect / disconnect lifecycle', async () => {
    await bridge.connect();
    expect(bridge.isConnected()).toBe(true);
    // With injected app, we do NOT call app.start()
    expect(fake.start).not.toHaveBeenCalled();
    await bridge.disconnect();
    expect(bridge.isConnected()).toBe(false);
    expect(fake.stop).toHaveBeenCalled();
  });

  it('message event → IncomingMessage (skips subtype events)', async () => {
    await bridge.connect();
    const handler = vi.fn<(m: IncomingMessage) => void>();
    bridge.onMessage(handler);

    // Subtype (bot/edit/etc.) — ignored
    await fake.emitMessage({
      subtype: 'bot_message',
      user: 'U1',
      text: 'ignore me',
      ts: '1.0',
      channel: 'C1',
    });
    expect(handler).not.toHaveBeenCalled();

    // Regular user message — delivered
    await fake.emitMessage({
      user: 'U-admin',
      text: 'hello from slack',
      ts: '1700000000.000100',
      channel: 'C1',
      thread_ts: '1700000000.000050',
    });
    expect(handler).toHaveBeenCalledOnce();
    const msg = handler.mock.calls[0]![0];
    expect(msg.text).toBe('hello from slack');
    expect(msg.user).toMatchObject({ id: 'U-admin', isAdmin: true });
    expect(msg.channel).toMatchObject({ id: 'C1', threadId: '1700000000.000050' });
  });

  it('block_actions button → IncomingMessage with frameType=block_actions', async () => {
    await bridge.connect();
    const handler = vi.fn<(m: IncomingMessage) => void>();
    bridge.onMessage(handler);

    const ack = vi.fn(async () => undefined);
    await fake.emitAction({
      action: { action_id: 'approve', value: 'approve' },
      body: {
        user: { id: 'U2', username: 'bob' },
        channel: { id: 'C1' },
        trigger_id: 't1',
      },
      ack,
    });

    expect(handler).toHaveBeenCalledOnce();
    expect(handler.mock.calls[0]![0].text).toBe('approve');
    expect(handler.mock.calls[0]![0].platformData?.frameType).toBe('block_actions');
    expect(ack).toHaveBeenCalled();
  });

  it('send() posts via chat.postMessage with text + blocks', async () => {
    await bridge.connect();
    await bridge.send('C1', {
      text: 'hello',
      buttons: [{ label: 'Yes', value: 'yes', style: 'primary' }],
    });
    expect(fake.client.chat.postMessage).toHaveBeenCalledOnce();
    const call = fake.client.chat.postMessage.mock.calls[0]![0] as {
      channel: string;
      text: string;
      blocks?: unknown[];
    };
    expect(call.channel).toBe('C1');
    expect(call.text).toBe('hello');
    expect(call.blocks).toHaveLength(2); // section + actions
  });

  it('send() pre-connect throws', async () => {
    await expect(bridge.send('C1', { text: 'x' })).rejects.toThrow(/not connected/i);
  });

  it('getCapabilities: threads + slash commands + files + buttons', () => {
    const c = bridge.getCapabilities();
    expect(c.files).toBe(true);
    expect(c.threads).toBe(true);
    expect(c.slashCommands).toBe(true);
    expect(c.buttons).toBe(true);
  });
});
