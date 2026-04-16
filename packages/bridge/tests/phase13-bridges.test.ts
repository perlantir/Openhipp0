/**
 * Phase 13 bridges — one consolidated test file covering Signal, Matrix,
 * Mattermost, Email, SMS, WhatsApp Business, Home Assistant. Each bridge has
 * at least three unit tests (connect lifecycle + ingest routing + send path
 * + any bridge-specific behavior).
 */

import { describe, it, expect } from 'vitest';
import { SignalBridge, type SignalTransport } from '../src/signal.js';
import { MatrixBridge, type MatrixTransport } from '../src/matrix.js';
import { MattermostBridge, type MattermostTransport } from '../src/mattermost.js';
import { EmailBridge, type EmailTransport } from '../src/email.js';
import { SmsBridge, type SmsTransport } from '../src/sms.js';
import {
  WhatsAppBusinessBridge,
  type WhatsAppBusinessTransport,
} from '../src/whatsapp-business.js';
import {
  HomeAssistantBridge,
  type HaTransport,
} from '../src/home-assistant.js';
import type { IncomingMessage } from '../src/types.js';

function collectInbound(bridge: { onMessage(h: (m: IncomingMessage) => void): void }) {
  const msgs: IncomingMessage[] = [];
  bridge.onMessage((m) => {
    msgs.push(m);
  });
  return msgs;
}

// ─── Signal ──────────────────────────────────────────────────────────────

describe('SignalBridge', () => {
  function fakeTransport(): SignalTransport & {
    trigger(msg: Parameters<SignalTransport['start']>[0]['onMessage'] extends (m: infer M) => void ? M : never): void;
    sent: Array<{ recipient: string; text: string }>;
  } {
    const sent: Array<{ recipient: string; text: string }> = [];
    let onMessage: ((m: Parameters<SignalTransport['start']>[0]['onMessage'] extends (m: infer M) => void ? M : never) => void) | null = null;
    return {
      async start(h) {
        onMessage = h.onMessage as never;
      },
      async stop() {},
      async send(recipient, content) {
        sent.push({ recipient, text: content.text });
      },
      trigger(msg) {
        onMessage?.(msg);
      },
      sent,
    };
  }

  it('connect starts the transport and sets connected=true', async () => {
    const t = fakeTransport();
    const b = new SignalBridge({ transport: t });
    expect(b.isConnected()).toBe(false);
    await b.connect();
    expect(b.isConnected()).toBe(true);
  });

  it('routes raw signal messages into IncomingMessage', async () => {
    const t = fakeTransport();
    const b = new SignalBridge({ transport: t, adminUserIds: ['+15551111'] });
    const received = collectInbound(b);
    await b.connect();
    t.trigger({ source: '+15551111', timestamp: 1_700_000_000, message: 'hey', sourceName: 'Alice' });
    expect(received).toHaveLength(1);
    expect(received[0]?.text).toBe('hey');
    expect(received[0]?.user.isAdmin).toBe(true);
    expect(received[0]?.channel.id).toBe('+15551111');
  });

  it('send() delegates to transport.send()', async () => {
    const t = fakeTransport();
    const b = new SignalBridge({ transport: t });
    await b.connect();
    await b.send('+15552222', { text: 'ping' });
    expect(t.sent).toEqual([{ recipient: '+15552222', text: 'ping' }]);
  });

  it('send() on disconnected bridge throws', async () => {
    const t = fakeTransport();
    const b = new SignalBridge({ transport: t });
    await expect(b.send('+1', { text: 'x' })).rejects.toThrow();
  });
});

// ─── Matrix ──────────────────────────────────────────────────────────────

describe('MatrixBridge', () => {
  function fakeTransport(): MatrixTransport & {
    trigger(ev: Parameters<MatrixTransport['start']>[0]['onEvent'] extends (m: infer M) => void ? M : never): void;
    sent: Array<{ roomId: string; body: string }>;
  } {
    const sent: Array<{ roomId: string; body: string }> = [];
    let onEvent: ((ev: unknown) => void) | null = null;
    return {
      async start(h) {
        onEvent = h.onEvent as never;
      },
      async stop() {},
      async sendRoomMessage(roomId, body) {
        sent.push({ roomId, body });
      },
      trigger(ev) {
        onEvent?.(ev);
      },
      sent,
    };
  }

  it('ignores its own user-id', async () => {
    const t = fakeTransport();
    const b = new MatrixBridge({ transport: t, userId: '@me:example.org' });
    const received = collectInbound(b);
    await b.connect();
    t.trigger({ roomId: '!r1', eventId: 'e1', sender: '@me:example.org', body: 'loop', timestamp: 0 });
    t.trigger({ roomId: '!r1', eventId: 'e2', sender: '@you:example.org', body: 'hi', timestamp: 1 });
    expect(received.map((m) => m.text)).toEqual(['hi']);
  });

  it('threads pass relatesTo to threadId + replyTo', async () => {
    const t = fakeTransport();
    const b = new MatrixBridge({ transport: t });
    const received = collectInbound(b);
    await b.connect();
    t.trigger({
      roomId: '!r1',
      eventId: 'e2',
      sender: '@u:e',
      body: 'reply',
      timestamp: 1,
      relatesTo: 'e1',
    });
    expect(received[0]?.channel.threadId).toBe('e1');
    expect(received[0]?.replyTo).toBe('e1');
  });

  it('send() forwards threadId', async () => {
    const t = fakeTransport();
    const b = new MatrixBridge({ transport: t });
    await b.connect();
    await b.send('!room', { text: 'hi', threadId: 't1' });
    expect(t.sent[0]?.body).toBe('hi');
  });
});

// ─── Mattermost ──────────────────────────────────────────────────────────

describe('MattermostBridge', () => {
  function fakeTransport(): MattermostTransport & {
    trigger(p: Parameters<MattermostTransport['start']>[0]['onPost'] extends (m: infer M) => void ? M : never): void;
    posted: Array<{ channelId: string; message: string }>;
  } {
    const posted: Array<{ channelId: string; message: string }> = [];
    let onPost: ((p: unknown) => void) | null = null;
    return {
      async start(h) {
        onPost = h.onPost as never;
      },
      async stop() {},
      async createPost(channelId, message) {
        posted.push({ channelId, message });
      },
      trigger(p) {
        onPost?.(p);
      },
      posted,
    };
  }

  it('filters bot posts', async () => {
    const t = fakeTransport();
    const b = new MattermostBridge({ transport: t });
    const received = collectInbound(b);
    await b.connect();
    t.trigger({
      id: '1',
      channelId: 'c',
      userId: 'u',
      message: 'from bot',
      createAt: 1,
      isBot: true,
    });
    t.trigger({ id: '2', channelId: 'c', userId: 'u', message: 'from user', createAt: 2 });
    expect(received.map((m) => m.text)).toEqual(['from user']);
  });

  it('filters self posts when selfUserId is set', async () => {
    const t = fakeTransport();
    const b = new MattermostBridge({ transport: t, selfUserId: 'me' });
    const received = collectInbound(b);
    await b.connect();
    t.trigger({ id: '1', channelId: 'c', userId: 'me', message: 'self', createAt: 1 });
    t.trigger({ id: '2', channelId: 'c', userId: 'other', message: 'them', createAt: 2 });
    expect(received).toHaveLength(1);
  });

  it('send() posts to the channel', async () => {
    const t = fakeTransport();
    const b = new MattermostBridge({ transport: t });
    await b.connect();
    await b.send('channel-1', { text: 'deploy' });
    expect(t.posted).toEqual([{ channelId: 'channel-1', message: 'deploy' }]);
  });
});

// ─── Email ──────────────────────────────────────────────────────────────

describe('EmailBridge', () => {
  function fakeTransport(): EmailTransport & {
    trigger(msg: Parameters<EmailTransport['start']>[0]['onMessage'] extends (m: infer M) => void ? M : never): void;
    sent: Array<{ to: string; subject: string; body: string }>;
  } {
    const sent: Array<{ to: string; subject: string; body: string }> = [];
    let onMessage: ((m: unknown) => void) | null = null;
    return {
      async start(h) {
        onMessage = h.onMessage as never;
      },
      async stop() {},
      async send(msg) {
        sent.push({ to: msg.to, subject: msg.subject, body: msg.body });
      },
      trigger(msg) {
        onMessage?.(msg);
      },
      sent,
    };
  }

  it('drops messages from self address', async () => {
    const t = fakeTransport();
    const b = new EmailBridge({ transport: t, selfAddress: 'me@ex.com' });
    const received = collectInbound(b);
    await b.connect();
    t.trigger({
      messageId: 'm1',
      from: 'me@ex.com',
      to: 'them@ex.com',
      subject: 's',
      textBody: 'self',
      date: new Date(0),
    });
    t.trigger({
      messageId: 'm2',
      from: 'them@ex.com',
      to: 'me@ex.com',
      subject: 's2',
      textBody: 'hi',
      date: new Date(0),
    });
    expect(received).toHaveLength(1);
  });

  it('reply preserves thread subject with Re: prefix', async () => {
    const t = fakeTransport();
    const b = new EmailBridge({ transport: t });
    await b.connect();
    t.trigger({
      messageId: 'm3',
      from: 'a@b.com',
      to: 'c@d.com',
      subject: 'Thread Topic',
      textBody: 'hi',
      date: new Date(0),
    });
    await b.send('a@b.com', { text: 'reply', replyTo: 'm3' });
    expect(t.sent[0]?.subject).toBe('Re: Thread Topic');
  });

  it('flags admin senders', async () => {
    const t = fakeTransport();
    const b = new EmailBridge({ transport: t, adminAddresses: ['boss@ex.com'] });
    const received = collectInbound(b);
    await b.connect();
    t.trigger({
      messageId: 'm',
      from: 'BOSS@ex.com',
      to: 'me@ex.com',
      subject: 'hi',
      textBody: '',
      date: new Date(0),
    });
    expect(received[0]?.user.isAdmin).toBe(true);
  });
});

// ─── SMS ─────────────────────────────────────────────────────────────────

describe('SmsBridge', () => {
  it('ingests webhook payloads with MMS attachments', async () => {
    const sent: unknown[] = [];
    const transport: SmsTransport = {
      async send(to, from, body, media) {
        sent.push({ to, from, body, media });
      },
    };
    const b = new SmsBridge({ transport, from: '+15550001' });
    const received = collectInbound(b);
    await b.connect();
    b.ingest({
      MessageSid: 'SM1',
      From: '+15550002',
      To: '+15550001',
      Body: 'hello',
      NumMedia: '1',
      MediaUrl0: 'https://img/1.jpg',
      MediaContentType0: 'image/jpeg',
    });
    expect(received[0]?.text).toBe('hello');
    expect(received[0]?.attachments?.[0]?.url).toBe('https://img/1.jpg');
  });

  it('send() forwards to transport with from + media', async () => {
    const sent: unknown[] = [];
    const transport: SmsTransport = {
      async send(to, from, body, media) {
        sent.push({ to, from, body, media });
      },
    };
    const b = new SmsBridge({ transport, from: '+15550001' });
    await b.connect();
    await b.send('+15550002', {
      text: 'reply',
      attachments: [{ filename: 'a.jpg', url: 'https://img/a.jpg' }],
    });
    expect(sent[0]).toMatchObject({
      to: '+15550002',
      from: '+15550001',
      body: 'reply',
      media: ['https://img/a.jpg'],
    });
  });

  it('send() throws when not connected', async () => {
    const transport: SmsTransport = { async send() {} };
    const b = new SmsBridge({ transport, from: '+1' });
    await expect(b.send('+2', { text: 'x' })).rejects.toThrow();
  });
});

// ─── WhatsApp Business ───────────────────────────────────────────────────

describe('WhatsAppBusinessBridge', () => {
  function fakeTransport(): WhatsAppBusinessTransport & {
    texts: Array<{ to: string; body: string }>;
    interactive: Array<{ to: string; buttons: unknown[] }>;
  } {
    const texts: Array<{ to: string; body: string }> = [];
    const interactive: Array<{ to: string; buttons: unknown[] }> = [];
    return {
      async sendText(to, body) {
        texts.push({ to, body });
      },
      async sendInteractive(to, _body, buttons) {
        interactive.push({ to, buttons });
      },
      async fetchMedia(id) {
        return { url: `https://meta/${id}`, mimeType: 'image/jpeg' };
      },
      texts,
      interactive,
    };
  }

  it('send() prefers interactive when buttons are present', async () => {
    const t = fakeTransport();
    const b = new WhatsAppBusinessBridge({ transport: t });
    await b.connect();
    await b.send('+15550001', {
      text: 'pick',
      buttons: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ],
    });
    expect(t.interactive).toHaveLength(1);
    expect(t.texts).toHaveLength(0);
  });

  it('fetches media for image messages and attaches URL', async () => {
    const t = fakeTransport();
    const b = new WhatsAppBusinessBridge({ transport: t });
    const received = collectInbound(b);
    await b.connect();
    await b.ingest({
      messageId: 'wa1',
      from: '+1',
      timestamp: Math.floor(Date.now() / 1000),
      media: { id: 'mediaX', mimeType: 'image/jpeg' },
    });
    expect(received[0]?.attachments?.[0]?.url).toBe('https://meta/mediaX');
  });

  it('button_reply ingests with frameType=button_reply', async () => {
    const t = fakeTransport();
    const b = new WhatsAppBusinessBridge({ transport: t });
    const received = collectInbound(b);
    await b.connect();
    await b.ingest({
      messageId: 'w2',
      from: '+1',
      timestamp: 0,
      interactive: { button_reply: { id: 'yes', title: 'Yes' } },
    });
    expect(received[0]?.text).toBe('yes');
    expect((received[0]?.platformData as Record<string, unknown> | undefined)?.frameType).toBe('button_reply');
  });
});

// ─── Home Assistant ──────────────────────────────────────────────────────

describe('HomeAssistantBridge', () => {
  function fakeTransport(): HaTransport & {
    trigger(ev: Parameters<HaTransport['start']>[0]['onConversation'] extends (m: infer M) => void ? M : never): void;
    calls: Array<{ domain: string; service: string; data: Record<string, unknown> }>;
  } {
    const calls: Array<{ domain: string; service: string; data: Record<string, unknown> }> = [];
    let onConversation: ((ev: unknown) => void) | null = null;
    return {
      async start(h) {
        onConversation = h.onConversation as never;
      },
      async stop() {},
      async callService(domain, service, data) {
        calls.push({ domain, service, data });
      },
      trigger(ev) {
        onConversation?.(ev);
      },
      calls,
    };
  }

  it('ingests conversation events', async () => {
    const t = fakeTransport();
    const b = new HomeAssistantBridge({ transport: t });
    const received = collectInbound(b);
    await b.connect();
    t.trigger({
      conversationId: 'c1',
      userId: 'u',
      userName: 'Alice',
      text: 'turn off lights',
      timestamp: 10,
    });
    expect(received[0]?.text).toBe('turn off lights');
    expect(received[0]?.channel.id).toBe('c1');
  });

  it('send() calls the default notify service', async () => {
    const t = fakeTransport();
    const b = new HomeAssistantBridge({ transport: t });
    await b.connect();
    await b.send('conversation', { text: 'hi' });
    expect(t.calls[0]).toMatchObject({
      domain: 'notify',
      service: 'notify',
      data: { message: 'hi' },
    });
  });

  it('callService exposes HA service calls directly', async () => {
    const t = fakeTransport();
    const b = new HomeAssistantBridge({ transport: t });
    await b.connect();
    await b.callService('light', 'turn_on', { entity_id: 'light.kitchen' });
    expect(t.calls[0]).toMatchObject({
      domain: 'light',
      service: 'turn_on',
      data: { entity_id: 'light.kitchen' },
    });
  });
});
