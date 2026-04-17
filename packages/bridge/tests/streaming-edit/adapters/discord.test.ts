import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DiscordAPIError, HTTPError, RateLimitError } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';

import {
  DiscordEditStreamingAdapter,
  classifyDiscordError,
  isParsedInteraction,
  parseButtonInteraction,
} from '../../../src/streaming-edit/adapters/discord.js';
import { StreamingEditError } from '../../../src/streaming-edit/types.js';

type FixtureEntry =
  | {
      type: 'DiscordAPIError';
      code: number;
      status: number;
      message: string;
      retryAfterSeconds?: number;
    }
  | { type: 'HTTPError'; status: number; statusText: string }
  | {
      type: 'RateLimitError';
      timeToReset: number;
      retryAfter: number;
      limit: number;
      method: string;
      hash: string;
      url: string;
      route: string;
      majorParameter: string;
      global: boolean;
      sublimitTimeout: number;
      scope: 'user' | 'global' | 'shared';
    };

const FIXTURES = JSON.parse(
  readFileSync(
    resolve(fileURLToPath(new URL('./__fixtures__/discord-errors.json', import.meta.url))),
    'utf8',
  ),
) as Record<string, FixtureEntry>;

function discordErr(name: keyof typeof FIXTURES): unknown {
  const fx = FIXTURES[name]!;
  switch (fx.type) {
    case 'DiscordAPIError': {
      const raw =
        fx.retryAfterSeconds !== undefined
          ? { code: fx.code, message: fx.message, retry_after: fx.retryAfterSeconds }
          : { code: fx.code, message: fx.message };
      return new DiscordAPIError(raw, fx.code, fx.status, 'PATCH', '/channels/1/messages/2', {
        files: undefined,
        json: undefined,
      });
    }
    case 'HTTPError':
      return new HTTPError(fx.status, fx.statusText, 'PATCH', '/channels/1/messages/2', {
        files: undefined,
        json: undefined,
      });
    case 'RateLimitError': {
      const { type: _t, ...data } = fx;
      return new RateLimitError(data);
    }
  }
}

interface FakeMessage {
  edit: ReturnType<typeof vi.fn>;
  id: string;
}

interface FakeChannel {
  send: ReturnType<typeof vi.fn>;
  messages: { fetch: ReturnType<typeof vi.fn> };
}

function fakeClient() {
  const sentMessage: FakeMessage = { edit: vi.fn().mockResolvedValue(undefined), id: 'sent-id-1' };
  const channel: FakeChannel = {
    send: vi.fn().mockResolvedValue(sentMessage),
    messages: { fetch: vi.fn().mockResolvedValue(sentMessage) },
  };
  const client = {
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  };
  return {
    client: client as unknown as Parameters<
      typeof DiscordEditStreamingAdapter
    >[0]['client'],
    channel,
    sentMessage,
  };
}

// ─── classifyDiscordError ────────────────────────────────────────────────────

describe('classifyDiscordError', () => {
  it('1. RateLimitError → rate-limit with retryAfterMs (ms, no ×1000)', () => {
    const c = classifyDiscordError(discordErr('rateLimited'));
    expect(c.kind).toBe('classified');
    if (c.kind === 'classified') {
      expect(c.error).toBeInstanceOf(StreamingEditError);
      expect(c.error.kind).toBe('rate-limit');
      expect(c.error.retryAfterMs).toBe(1500);
    }
  });

  it('2. DiscordAPIError code 10008 (Unknown Message) → permanent', () => {
    const c = classifyDiscordError(discordErr('unknownMessage'));
    expect(c.kind).toBe('classified');
    if (c.kind === 'classified') expect(c.error.kind).toBe('permanent');
  });

  it('3. DiscordAPIError code 50001 (Missing Access) → permanent', () => {
    const c = classifyDiscordError(discordErr('missingAccess'));
    expect(c.kind).toBe('classified');
    if (c.kind === 'classified') expect(c.error.kind).toBe('permanent');
  });

  it('4. DiscordAPIError status 403 (no permanent code) → permanent', () => {
    const c = classifyDiscordError(discordErr('forbidden'));
    expect(c.kind).toBe('classified');
    if (c.kind === 'classified') expect(c.error.kind).toBe('permanent');
  });

  it('5. HTTPError status 502 → transient', () => {
    const c = classifyDiscordError(discordErr('badGateway'));
    expect(c.kind).toBe('classified');
    if (c.kind === 'classified') expect(c.error.kind).toBe('transient');
  });

  it('6. plain Error with code ECONNRESET → transient', () => {
    const e = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const c = classifyDiscordError(e);
    expect(c.kind).toBe('classified');
    if (c.kind === 'classified') expect(c.error.kind).toBe('transient');
  });

  it('7. unknown Error shape → transient (safe default)', () => {
    const c = classifyDiscordError(new Error('something weird'));
    expect(c.kind).toBe('classified');
    if (c.kind === 'classified') expect(c.error.kind).toBe('transient');
  });

  it('8. non-Error throw (string) → unknown', () => {
    expect(classifyDiscordError('boom').kind).toBe('unknown');
  });
});

// ─── parseButtonInteraction / isParsedInteraction ────────────────────────────

describe('parseButtonInteraction / isParsedInteraction', () => {
  it('9. extracts customId from a button-shaped interaction', () => {
    const interaction = {
      isButton: () => true,
      customId: 'hipp0-approve:abc',
      update: vi.fn().mockResolvedValue(undefined),
    };
    const parsed = parseButtonInteraction(interaction);
    expect(parsed).not.toBeNull();
    expect(parsed!.customId).toBe('hipp0-approve:abc');
    expect(typeof parsed!.update).toBe('function');
  });

  it('10. returns null for non-button / missing fields', () => {
    expect(parseButtonInteraction(null)).toBeNull();
    expect(parseButtonInteraction('not an object')).toBeNull();
    // isButton returns false (e.g. ChatInputCommandInteraction)
    expect(parseButtonInteraction({ isButton: () => false, customId: 'x' })).toBeNull();
    // Missing customId
    expect(parseButtonInteraction({ isButton: () => true, update: () => Promise.resolve() })).toBeNull();
    // Missing update
    expect(parseButtonInteraction({ isButton: () => true, customId: 'x' })).toBeNull();
  });

  it('11. isParsedInteraction accepts parsed shape, rejects full interaction', () => {
    const parsedShape = { customId: 'x', update: () => Promise.resolve() };
    expect(isParsedInteraction(parsedShape)).toBe(true);
    // Full interaction has isButton — must be rejected so onInteraction
    // routes it through parseButtonInteraction instead. PR #9 lesson #3.
    const fullInteraction = {
      customId: 'x',
      update: () => Promise.resolve(),
      isButton: () => true,
    };
    expect(isParsedInteraction(fullInteraction)).toBe(false);
  });
});

// ─── sessionOptions callbacks ────────────────────────────────────────────────

describe('DiscordEditStreamingAdapter — sessionOptions callbacks', () => {
  it('12. editFn fetches the message and calls msg.edit(text)', async () => {
    const { client, channel, sentMessage } = fakeClient();
    const adapter = new DiscordEditStreamingAdapter({ client, channelId: 'chan-1' });
    const { editFn } = adapter.sessionOptions();
    await editFn('msg-42', 'hello world');
    expect(channel.messages.fetch).toHaveBeenCalledWith('msg-42');
    expect(sentMessage.edit).toHaveBeenCalledWith('hello world');
  });

  it('13. editFn on RateLimitError throws StreamingEditError with retryAfterMs', async () => {
    const { client, sentMessage } = fakeClient();
    sentMessage.edit.mockRejectedValueOnce(discordErr('rateLimited'));
    const adapter = new DiscordEditStreamingAdapter({ client, channelId: 'chan-1' });
    const { editFn } = adapter.sessionOptions();
    await expect(editFn('1', 'x')).rejects.toMatchObject({
      name: 'StreamingEditError',
      kind: 'rate-limit',
      retryAfterMs: 1500,
    });
  });

  it('14. editFn on DiscordAPIError 10008 throws permanent', async () => {
    const { client, sentMessage } = fakeClient();
    sentMessage.edit.mockRejectedValueOnce(discordErr('unknownMessage'));
    const adapter = new DiscordEditStreamingAdapter({ client, channelId: 'chan-1' });
    const { editFn } = adapter.sessionOptions();
    await expect(editFn('1', 'x')).rejects.toMatchObject({
      name: 'StreamingEditError',
      kind: 'permanent',
    });
  });

  it('15. sendFn calls channel.send and returns the new message id', async () => {
    const { client, channel } = fakeClient();
    channel.send.mockResolvedValueOnce({ id: 'new-msg-99' });
    const adapter = new DiscordEditStreamingAdapter({ client, channelId: 'chan-1' });
    const { sendFn } = adapter.sessionOptions();
    await expect(sendFn('rotated text')).resolves.toBe('new-msg-99');
    expect(channel.send).toHaveBeenCalledWith('rotated text');
  });

  it('16. sessionOptions reports maxMessageBytes=2000, debounceMs=200, no finalFormatEdit', () => {
    const { client } = fakeClient();
    const adapter = new DiscordEditStreamingAdapter({ client, channelId: 'chan-1' });
    const opts = adapter.sessionOptions();
    expect(opts.maxMessageBytes).toBe(2000);
    expect(opts.debounceMs).toBe(200);
    // DECISION 10-B: no finalFormatEdit hook (Discord renders standard markdown
    // during streaming — no terminal re-edit needed).
    expect((opts as Record<string, unknown>).finalFormatEdit).toBeUndefined();
    expect('finalFormatEdit' in opts).toBe(false);
  });
});

// ─── approvalResolver + onInteraction ────────────────────────────────────────

const PREVIEW_BASE = {
  kind: 'tool-call-preview' as const,
  turnId: 't',
  at: 'a',
  toolName: 'send_email',
  args: { to: 'x@y.z', subject: 's', body: 'hello' },
  previewStrategy: 'preview-approval' as const,
};

async function flushMicro(times = 3): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('DiscordEditStreamingAdapter — approvalResolver + onInteraction', () => {
  it('17. posts a separate message with embed + ActionRow carrying prefixed customIds', async () => {
    const { client, channel } = fakeClient();
    const adapter = new DiscordEditStreamingAdapter({ client, channelId: 'chan-prompt' });
    const resolver = adapter.approvalResolver();
    const p = resolver({ ...PREVIEW_BASE, approvalId: 'aid-17' });
    await flushMicro();
    expect(channel.send).toHaveBeenCalledOnce();
    const sendArg = channel.send.mock.calls[0]![0] as {
      embeds: unknown[];
      components: { components: { data: { custom_id: string } }[] }[];
    };
    expect(sendArg.embeds).toHaveLength(1);
    expect(sendArg.components).toHaveLength(1);
    const buttons = sendArg.components[0]!.components.map((b) => b.data.custom_id);
    expect(buttons).toContain('hipp0-approve:aid-17');
    expect(buttons).toContain('hipp0-reject:aid-17');
    // Resolve so the test promise doesn't dangle.
    await adapter.onInteraction({
      customId: 'hipp0-approve:aid-17',
      update: vi.fn().mockResolvedValue(undefined),
    });
    await expect(p).resolves.toEqual({ approvalId: 'aid-17', approved: true });
  });

  it('18. approve interaction → resolver resolves approved=true; ack strips components', async () => {
    const { client } = fakeClient();
    const adapter = new DiscordEditStreamingAdapter({ client, channelId: 'chan-1' });
    const resolver = adapter.approvalResolver();
    const p = resolver({ ...PREVIEW_BASE, approvalId: 'aid-18' });
    await flushMicro();
    const update = vi.fn().mockResolvedValue(undefined);
    await adapter.onInteraction({ customId: 'hipp0-approve:aid-18', update });
    await expect(p).resolves.toEqual({ approvalId: 'aid-18', approved: true });
    expect(update).toHaveBeenCalledWith({ components: [] });
  });

  it('19. reject interaction → resolver resolves approved=false', async () => {
    const { client } = fakeClient();
    const adapter = new DiscordEditStreamingAdapter({ client, channelId: 'chan-1' });
    const resolver = adapter.approvalResolver();
    const p = resolver({ ...PREVIEW_BASE, approvalId: 'aid-19' });
    await flushMicro();
    await adapter.onInteraction({
      customId: 'hipp0-reject:aid-19',
      update: vi.fn().mockResolvedValue(undefined),
    });
    await expect(p).resolves.toEqual({ approvalId: 'aid-19', approved: false });
  });

  it('20. foreign customId is ignored; resolver stays pending', async () => {
    const { client } = fakeClient();
    const adapter = new DiscordEditStreamingAdapter({ client, channelId: 'chan-1' });
    const resolver = adapter.approvalResolver();
    let settled = false;
    const p = resolver({ ...PREVIEW_BASE, approvalId: 'real-20' }).then((d) => {
      settled = true;
      return d;
    });
    await flushMicro();
    // Foreign customId — wrong approvalId.
    await adapter.onInteraction({
      customId: 'hipp0-approve:stale',
      update: vi.fn().mockResolvedValue(undefined),
    });
    // Non-hipp0 customId entirely.
    await adapter.onInteraction({
      customId: 'someone-elses-button',
      update: vi.fn().mockResolvedValue(undefined),
    });
    await flushMicro();
    expect(settled).toBe(false);
    // Now the real one.
    await adapter.onInteraction({
      customId: 'hipp0-reject:real-20',
      update: vi.fn().mockResolvedValue(undefined),
    });
    await expect(p).resolves.toEqual({ approvalId: 'real-20', approved: false });
  });

  it('21. _debugPendingCount probe: 0 → 1 → 0 → 0 across late tap (no leak)', async () => {
    const { client } = fakeClient();
    const adapter = new DiscordEditStreamingAdapter({ client, channelId: 'chan-1' });
    expect(adapter._debugPendingCount()).toBe(0);
    const resolver = adapter.approvalResolver();
    const p = resolver({ ...PREVIEW_BASE, approvalId: 'aid-21' });
    await flushMicro();
    expect(adapter._debugPendingCount()).toBe(1);
    await adapter.onInteraction({
      customId: 'hipp0-approve:aid-21',
      update: vi.fn().mockResolvedValue(undefined),
    });
    await p;
    expect(adapter._debugPendingCount()).toBe(0);
    // Late tap with the same customId after cleanup — must NOT leak a
    // Map entry. PR #9 cleanup parity (DECISION 4 / 10-C).
    await adapter.onInteraction({
      customId: 'hipp0-approve:aid-21',
      update: vi.fn().mockResolvedValue(undefined),
    });
    expect(adapter._debugPendingCount()).toBe(0);
  });

  it('22. prompt-post failure → resolver returns approved:false with prompt-post-failed reason', async () => {
    const { client, channel } = fakeClient();
    channel.send.mockRejectedValueOnce(new Error('network down'));
    const adapter = new DiscordEditStreamingAdapter({ client, channelId: 'chan-1' });
    const resolver = adapter.approvalResolver();
    const decision = await resolver({ ...PREVIEW_BASE, approvalId: 'aid-22' });
    expect(decision.approvalId).toBe('aid-22');
    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain('prompt-post-failed');
    expect(decision.reason).toContain('network down');
  });
});

// ─── Invariant test (DECISION 10-F dead-branch claim) ────────────────────────

describe('classifyDiscordError invariant', () => {
  it('23. no fixture in __fixtures__/discord-errors.json ever returns kind=absorb', () => {
    for (const name of Object.keys(FIXTURES)) {
      const err = discordErr(name as keyof typeof FIXTURES);
      const c = classifyDiscordError(err);
      expect(
        c.kind,
        `fixture "${name}" classified as ${c.kind}; absorb branch must remain dead per DECISION 10-F`,
      ).not.toBe('absorb');
    }
  });
});
