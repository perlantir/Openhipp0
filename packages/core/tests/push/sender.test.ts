import { describe, expect, it, vi } from 'vitest';
import {
  InMemoryPushRegistry,
  PushSender,
  type ExpoPushMessage,
  type ExpoPushTicket,
  type PushEvent,
  type PushTransport,
} from '../../src/push/index.js';

function fakeTransport(tickets: ExpoPushTicket[]): PushTransport & { sent: ExpoPushMessage[] } {
  const sent: ExpoPushMessage[] = [];
  return {
    sent,
    async send(messages) {
      sent.push(...messages);
      return tickets.slice(0, messages.length);
    },
  };
}

const CHAT_EVENT: PushEvent = {
  kind: 'chat',
  title: 'Claude',
  body: 'Your scheduled summary is ready',
  refId: 'msg-1',
};

describe('PushSender.fanOut', () => {
  it('fans out to every registered device', async () => {
    const registry = new InMemoryPushRegistry();
    await registry.upsert({
      deviceId: 'a',
      pushToken: 'ExponentPushToken[a]',
      platform: 'ios',
      updatedAt: '2026-04-16T00:00:00Z',
    });
    await registry.upsert({
      deviceId: 'b',
      pushToken: 'ExponentPushToken[b]',
      platform: 'android',
      updatedAt: '2026-04-16T00:00:00Z',
    });
    const transport = fakeTransport([{ status: 'ok', id: '1' }, { status: 'ok', id: '2' }]);
    const sender = new PushSender({ registry, transport });

    const result = await sender.fanOut(CHAT_EVENT);
    expect(result).toEqual({ delivered: 2, pruned: 0, failed: 0 });
    expect(transport.sent).toHaveLength(2);
    expect(transport.sent[0]?.title).toBe('Claude');
    expect(transport.sent[0]?.data).toMatchObject({ kind: 'chat', refId: 'msg-1' });
    // Android gets the channel id for notification importance.
    const androidMsg = transport.sent.find((m) => m.to === 'ExponentPushToken[b]');
    expect(androidMsg?.channelId).toBe('default');
  });

  it('prunes DeviceNotRegistered tokens from the registry', async () => {
    const registry = new InMemoryPushRegistry();
    await registry.upsert({
      deviceId: 'a',
      pushToken: 'ExponentPushToken[a]',
      platform: 'ios',
      updatedAt: '2026-04-16T00:00:00Z',
    });
    const transport = fakeTransport([
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ]);
    const sender = new PushSender({ registry, transport });

    const result = await sender.fanOut(CHAT_EVENT);
    expect(result).toEqual({ delivered: 0, pruned: 1, failed: 0 });
    expect(await registry.get('a')).toBeUndefined();
  });

  it('counts generic errors as failed without pruning', async () => {
    const registry = new InMemoryPushRegistry();
    await registry.upsert({
      deviceId: 'a',
      pushToken: 'ExponentPushToken[a]',
      platform: 'ios',
      updatedAt: '2026-04-16T00:00:00Z',
    });
    const transport = fakeTransport([
      { status: 'error', details: { error: 'MessageRateExceeded' } },
    ]);
    const sender = new PushSender({ registry, transport });

    const result = await sender.fanOut(CHAT_EVENT);
    expect(result).toEqual({ delivered: 0, pruned: 0, failed: 1 });
    expect(await registry.get('a')).toBeDefined();
  });

  it('returns 0s when no devices are registered', async () => {
    const registry = new InMemoryPushRegistry();
    const transport = fakeTransport([]);
    const sender = new PushSender({ registry, transport });
    const result = await sender.fanOut(CHAT_EVENT);
    expect(result).toEqual({ delivered: 0, pruned: 0, failed: 0 });
    expect(transport.sent).toHaveLength(0);
  });

  it('urgent=false uses normal priority and no sound', async () => {
    const registry = new InMemoryPushRegistry();
    await registry.upsert({
      deviceId: 'a',
      pushToken: 'ExponentPushToken[a]',
      platform: 'ios',
      updatedAt: '2026-04-16T00:00:00Z',
    });
    const transport = fakeTransport([{ status: 'ok', id: '1' }]);
    const sender = new PushSender({ registry, transport });

    await sender.fanOut({ ...CHAT_EVENT, urgent: false });
    expect(transport.sent[0]?.priority).toBe('normal');
    expect(transport.sent[0]?.sound).toBeNull();
  });
});

describe('PushSender.sendTo', () => {
  it('is a no-op for unknown deviceId', async () => {
    const registry = new InMemoryPushRegistry();
    const send = vi.fn();
    const sender = new PushSender({ registry, transport: { send } });
    const result = await sender.sendTo('nobody', CHAT_EVENT);
    expect(result).toEqual({ delivered: false, pruned: false });
    expect(send).not.toHaveBeenCalled();
  });

  it('prunes dead token on sendTo', async () => {
    const registry = new InMemoryPushRegistry();
    await registry.upsert({
      deviceId: 'a',
      pushToken: 'ExponentPushToken[a]',
      platform: 'ios',
      updatedAt: '2026-04-16T00:00:00Z',
    });
    const transport = fakeTransport([
      { status: 'error', details: { error: 'DeviceNotRegistered' } },
    ]);
    const sender = new PushSender({ registry, transport });
    const result = await sender.sendTo('a', CHAT_EVENT);
    expect(result).toEqual({ delivered: false, pruned: true });
    expect(await registry.get('a')).toBeUndefined();
  });
});
