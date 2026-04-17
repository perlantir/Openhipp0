import { describe, expect, it, vi } from 'vitest';

import { IMessageBridge, type IMessageRawPayload, type IMessageTransport } from '../src/imessage.js';
import { TeamsBridge, type TeamsActivity, type TeamsTransport } from '../src/teams.js';
import { LineBridge, type LineTransport, type LineWebhookEvent } from '../src/line.js';
import { TwitchBridge, type TwitchRawMessage, type TwitchTransport } from '../src/twitch.js';
import { RocketChatBridge, type RocketChatRawMessage, type RocketChatTransport } from '../src/rocket-chat.js';
import { ZulipBridge, type ZulipRawMessage, type ZulipTransport } from '../src/zulip.js';

describe('IMessageBridge', () => {
  it('ingests + suppresses self-echo inside dedup window', async () => {
    let push: (m: IMessageRawPayload) => void = () => {};
    const transport: IMessageTransport = {
      async start(h) { push = h.onMessage; },
      async stop() {},
      async sendText() {},
    };
    const b = new IMessageBridge({ transport, dedupeWindowMs: 1_000 });
    const onMessage = vi.fn();
    b.onMessage(onMessage);
    await b.connect();
    push({ guid: 'g1', chatGuid: 'c1', handleId: 'u', text: 'hi', timestamp: Date.now(), fromMe: false });
    expect(onMessage).toHaveBeenCalledOnce();
    await b.send('c1', { text: 'hi back' });
    push({ guid: 'g2', chatGuid: 'c1', handleId: 'u', text: 'hi back', timestamp: Date.now(), fromMe: true });
    expect(onMessage).toHaveBeenCalledOnce();
  });
});

describe('TeamsBridge', () => {
  it('ingests "message" activities and sends via transport', async () => {
    let push: (a: TeamsActivity) => void = () => {};
    const sendActivity = vi.fn();
    const transport: TeamsTransport = {
      async start(h) { push = h.onActivity; },
      async stop() {},
      sendActivity,
    };
    const b = new TeamsBridge({ transport });
    const onMessage = vi.fn();
    b.onMessage(onMessage);
    await b.connect();
    push({
      id: 'a1',
      type: 'message',
      conversation: { id: 'chan', conversationType: 'channel' },
      from: { id: 'u1', name: 'alice' },
      text: 'hi',
    });
    expect(onMessage).toHaveBeenCalledOnce();
    await b.send('chan', { text: 'resp' });
    expect(sendActivity).toHaveBeenCalledOnce();
  });
});

describe('LineBridge', () => {
  it('uses reply() when replyToken available, pushText() after', async () => {
    let push: (e: LineWebhookEvent) => void = () => {};
    const reply = vi.fn();
    const pushText = vi.fn();
    const transport: LineTransport = {
      async start(h) { push = h.onEvent; },
      async stop() {},
      reply,
      pushText,
    };
    const b = new LineBridge({ transport });
    b.onMessage(() => {});
    await b.connect();
    push({
      type: 'message',
      timestamp: Date.now(),
      source: { type: 'user', userId: 'U1' },
      message: { id: 'm', type: 'text', text: 'hi' },
      replyToken: 'tok',
    });
    await b.send('U1', { text: 'r1' });
    expect(reply).toHaveBeenCalledOnce();
    await b.send('U1', { text: 'r2' });
    expect(pushText).toHaveBeenCalledOnce();
  });
});

describe('TwitchBridge', () => {
  it('sends with # prefix and filters bot echo', async () => {
    let push: (m: TwitchRawMessage) => void = () => {};
    const say = vi.fn();
    const transport: TwitchTransport = {
      async start(h) { push = h.onMessage; },
      async stop() {},
      say,
    };
    const onMessage = vi.fn();
    const b = new TwitchBridge({ transport, botUsername: 'hipp0bot' });
    b.onMessage(onMessage);
    await b.connect();
    push({ channel: '#alice', username: 'hipp0bot', userId: 'b', text: 'ignore', id: '1', timestamp: Date.now() });
    push({ channel: '#alice', username: 'bob', userId: 'u1', text: 'hi', id: '2', timestamp: Date.now() });
    expect(onMessage).toHaveBeenCalledOnce();
    await b.send('alice', { text: 'reply' });
    expect(say).toHaveBeenCalledWith('#alice', 'reply');
  });
});

describe('RocketChatBridge', () => {
  it('skips bot echo + system messages', async () => {
    let push: (m: RocketChatRawMessage) => void = () => {};
    const transport: RocketChatTransport = {
      async start(h) { push = h.onMessage; },
      async stop() {},
      async postMessage() {},
    };
    const onMessage = vi.fn();
    const b = new RocketChatBridge({ transport, botUserId: 'bot1' });
    b.onMessage(onMessage);
    await b.connect();
    push({ _id: '1', rid: 'r', msg: 'hi', u: { _id: 'u1', username: 'alice' }, ts: Date.now() });
    push({ _id: '2', rid: 'r', msg: 'x', u: { _id: 'bot1', username: 'bot' }, ts: Date.now() });
    push({ _id: '3', rid: 'r', msg: 's', u: { _id: 'u1', username: 'alice' }, ts: Date.now(), t: 'ul' });
    expect(onMessage).toHaveBeenCalledOnce();
  });
});

describe('ZulipBridge', () => {
  it('routes stream vs private based on platformData.zulipKind', async () => {
    const sendStream = vi.fn();
    const sendPrivate = vi.fn();
    const transport: ZulipTransport = {
      async start() {},
      async stop() {},
      sendStreamMessage: sendStream,
      sendPrivateMessage: sendPrivate,
    };
    const b = new ZulipBridge({ transport });
    b.onMessage(() => {});
    await b.connect();
    await b.send('general', {
      text: 'hi',
      platformData: { zulipKind: 'stream', stream: 'general', topic: 'welcome' },
    });
    expect(sendStream).toHaveBeenCalledWith('general', 'welcome', 'hi');
    await b.send('u@x.com', {
      text: 'dm',
      platformData: { zulipKind: 'private', email: 'u@x.com' },
    });
    expect(sendPrivate).toHaveBeenCalledWith('u@x.com', 'dm');
  });

  it('ingests stream messages with topic → threadId', async () => {
    let push: (m: ZulipRawMessage) => void = () => {};
    const transport: ZulipTransport = {
      async start(h) { push = h.onMessage; },
      async stop() {},
      async sendStreamMessage() {},
      async sendPrivateMessage() {},
    };
    const captured: unknown[] = [];
    const b = new ZulipBridge({ transport });
    b.onMessage((m) => { captured.push(m); });
    await b.connect();
    push({
      id: 42,
      sender_id: 7,
      sender_email: 'u@x',
      sender_full_name: 'U',
      type: 'stream',
      display_recipient: 'general',
      subject: 'welcome',
      content: 'hi',
      timestamp: 1_700_000_000,
    });
    expect(captured).toHaveLength(1);
  });
});
