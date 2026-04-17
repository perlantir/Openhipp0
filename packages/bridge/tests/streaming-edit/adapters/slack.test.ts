/**
 * Tests for `SlackEditStreamingAdapter` + `classifySlackError` +
 * `parseBlockActionsPayload` + `isParsedSlackInteraction`.
 *
 * Fixtures in `__fixtures__/slack-errors.json` provide error shapes the
 * classifier consumes; `slackErr()` in this file constructs Error-like
 * objects from them (matches how `discord.test.ts` does it).
 *
 * Coverage map to DECISIONs 11-A..11-I:
 *   T-1/T-2   DECISION 11-A (byte cap) + 11-G (debounce)
 *   T-4/T-5/T-6 DECISION 11-B (plain→mrkdwn + fallback)
 *   T-7..T-12 DECISION 11-C (response_url) + 11-H (UX)
 *   T-13..T-16 DECISION 11-D (parse surface)
 *   T-17..T-21 cleanup / pending-count
 *   T-22      DECISION 11-F invariant
 *   T-23      finalFormatEdit permanent-error propagation
 *   T-24/T-25 DECISION 11-F mapping + unknown branch
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  SlackEditStreamingAdapter,
  classifySlackError,
  isParsedSlackInteraction,
  parseBlockActionsPayload,
  type WebClientSurface,
} from '../../../src/streaming-edit/adapters/slack.js';
import { StreamingEditError } from '../../../src/streaming-edit/types.js';

// ─── Fixture machinery ──────────────────────────────────────────────────────

type PlatformFixture = {
  type: 'slack_webapi_platform_error';
  slackError: string;
  message: string;
  headers?: Record<string, string>;
};
type HttpFixture = {
  type: 'slack_webapi_http_error';
  statusCode: number;
  message: string;
  headers?: Record<string, string>;
};
type RateLimitedFixture = {
  type: 'slack_webapi_rate_limited_error';
  retryAfter: number;
  message: string;
};
type FixtureEntry = PlatformFixture | HttpFixture | RateLimitedFixture;

const FIXTURES = JSON.parse(
  readFileSync(
    resolve(fileURLToPath(new URL('./__fixtures__/slack-errors.json', import.meta.url))),
    'utf8',
  ),
) as Record<string, FixtureEntry>;

function slackErr(name: keyof typeof FIXTURES): Error {
  const fx = FIXTURES[name]!;
  const err = new Error(fx.message) as Error & Record<string, unknown>;
  err.code = fx.type;
  if (fx.type === 'slack_webapi_platform_error') {
    err.data = { ok: false, error: fx.slackError };
    if (fx.headers) err.headers = fx.headers;
  } else if (fx.type === 'slack_webapi_http_error') {
    err.statusCode = fx.statusCode;
    if (fx.headers) err.headers = fx.headers;
  } else if (fx.type === 'slack_webapi_rate_limited_error') {
    err.retryAfter = fx.retryAfter;
  }
  return err;
}

// ─── Fake WebClient ─────────────────────────────────────────────────────────

interface FakeWeb extends WebClientSurface {
  chat: {
    postMessage: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function fakeWeb(): FakeWeb {
  return {
    chat: {
      postMessage: vi.fn().mockResolvedValue({ ok: true, ts: '1700000000.000100' }),
      update: vi.fn().mockResolvedValue({ ok: true }),
    },
  };
}

function fakeFetch(): ReturnType<typeof vi.fn> {
  return vi
    .fn()
    .mockResolvedValue({ ok: true, status: 200, text: async () => '' } as unknown as Response);
}

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

// ─── sessionOptions ─────────────────────────────────────────────────────────

describe('SlackEditStreamingAdapter — sessionOptions', () => {
  it('T-1: sessionOptions returns 5 keys; maxMessageBytes=40000 (DECISION 11-A)', () => {
    const web = fakeWeb();
    const adapter = new SlackEditStreamingAdapter({ web, channel: 'C1' });
    const opts = adapter.sessionOptions();
    expect(opts.maxMessageBytes).toBe(40_000);
    // All five keys present — finalFormatEdit distinguishes Slack from Discord.
    expect('editFn' in opts).toBe(true);
    expect('sendFn' in opts).toBe(true);
    expect('finalFormatEdit' in opts).toBe(true);
    expect('maxMessageBytes' in opts).toBe(true);
    expect('debounceMs' in opts).toBe(true);
  });

  it('T-2: debounceMs defaults to 1000; override honored (DECISION 11-G)', () => {
    const web = fakeWeb();
    expect(new SlackEditStreamingAdapter({ web, channel: 'C1' }).sessionOptions().debounceMs).toBe(
      1000,
    );
    expect(
      new SlackEditStreamingAdapter({ web, channel: 'C1', debounceMs: 1500 })
        .sessionOptions().debounceMs,
    ).toBe(1500);
  });

  it('T-3: #sendFn calls chat.postMessage and returns ts as message id', async () => {
    const web = fakeWeb();
    web.chat.postMessage.mockResolvedValueOnce({ ok: true, ts: '1699999999.007001' });
    const adapter = new SlackEditStreamingAdapter({ web, channel: 'C42' });
    const { sendFn } = adapter.sessionOptions();
    await expect(sendFn('hello rotated')).resolves.toBe('1699999999.007001');
    expect(web.chat.postMessage).toHaveBeenCalledWith({ channel: 'C42', text: 'hello rotated' });
  });

  it('T-4: #editFn calls chat.update WITHOUT mrkdwn flag (plain during stream — DECISION 11-B)', async () => {
    const web = fakeWeb();
    const adapter = new SlackEditStreamingAdapter({ web, channel: 'C1' });
    const { editFn } = adapter.sessionOptions();
    await editFn('1700000000.000100', 'hello **not-yet-bold**');
    expect(web.chat.update).toHaveBeenCalledOnce();
    const arg = web.chat.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg['channel']).toBe('C1');
    expect(arg['ts']).toBe('1700000000.000100');
    expect(arg['text']).toBe('hello **not-yet-bold**');
    expect('mrkdwn' in arg).toBe(false);
  });

  it('T-5: #finalFormatEdit calls chat.update with mrkdwn=true + escaped text', async () => {
    const web = fakeWeb();
    const adapter = new SlackEditStreamingAdapter({ web, channel: 'C1' });
    const { finalFormatEdit } = adapter.sessionOptions();
    await finalFormatEdit!('1700000000.000100', 'see **bold** here');
    expect(web.chat.update).toHaveBeenCalledOnce();
    expect(web.chat.update).toHaveBeenCalledWith({
      channel: 'C1',
      ts: '1700000000.000100',
      text: 'see *bold* here',
      mrkdwn: true,
    });
  });

  it('T-6: #finalFormatEdit on parse-error → retries once with plain text, no mrkdwn', async () => {
    const web = fakeWeb();
    // First call: throw an invalid_arguments platform error → parse-error.
    const parseErr = new Error('invalid arguments') as Error & Record<string, unknown>;
    parseErr.code = 'slack_webapi_platform_error';
    parseErr.data = { ok: false, error: 'invalid_arguments' };
    web.chat.update.mockRejectedValueOnce(parseErr).mockResolvedValueOnce({ ok: true });
    const adapter = new SlackEditStreamingAdapter({ web, channel: 'C1' });
    const { finalFormatEdit } = adapter.sessionOptions();
    await finalFormatEdit!('1700000000.000100', 'see **bold** here');
    expect(web.chat.update).toHaveBeenCalledTimes(2);
    // First call: mrkdwn escaped.
    const first = web.chat.update.mock.calls[0]![0] as Record<string, unknown>;
    expect(first['mrkdwn']).toBe(true);
    expect(first['text']).toBe('see *bold* here');
    // Second call: fallback — original text, no mrkdwn flag.
    const second = web.chat.update.mock.calls[1]![0] as Record<string, unknown>;
    expect(second['text']).toBe('see **bold** here');
    expect('mrkdwn' in second).toBe(false);
  });
});

// ─── Approval flow ──────────────────────────────────────────────────────────

describe('SlackEditStreamingAdapter — approvalResolver + onInteraction', () => {
  it('T-7: approval posts a 3-block message (section, section, actions w/ 2 buttons) (DECISION 11-H1)', async () => {
    const web = fakeWeb();
    const fetchImpl = fakeFetch();
    const adapter = new SlackEditStreamingAdapter({
      web,
      channel: 'C1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const resolver = adapter.approvalResolver();
    const p = resolver({ ...PREVIEW_BASE, approvalId: 'aid-7' });
    await flushMicro();
    expect(web.chat.postMessage).toHaveBeenCalledOnce();
    const arg = web.chat.postMessage.mock.calls[0]![0] as {
      channel: string;
      text?: string;
      blocks?: Array<{ type: string; elements?: Array<{ action_id?: string }> }>;
    };
    expect(arg.channel).toBe('C1');
    expect(arg.blocks).toBeDefined();
    expect(arg.blocks).toHaveLength(3);
    expect(arg.blocks![0]!.type).toBe('section');
    expect(arg.blocks![1]!.type).toBe('section');
    expect(arg.blocks![2]!.type).toBe('actions');
    const actionIds = arg.blocks![2]!.elements!.map((e) => e.action_id);
    expect(actionIds).toContain('hipp0-approve:aid-7');
    expect(actionIds).toContain('hipp0-reject:aid-7');
    // Resolve so the test promise doesn't dangle.
    await adapter.onInteraction({
      actionId: 'hipp0-approve:aid-7',
      responseUrl: 'https://hooks.slack.com/actions/T/1/x',
    });
    await expect(p).resolves.toEqual({ approvalId: 'aid-7', approved: true });
  });

  it('T-8: summarizeArgsForApproval shows only keys, never values (secrets safety)', async () => {
    const web = fakeWeb();
    const adapter = new SlackEditStreamingAdapter({
      web,
      channel: 'C1',
      fetchImpl: fakeFetch() as unknown as typeof fetch,
    });
    const resolver = adapter.approvalResolver();
    void resolver({
      ...PREVIEW_BASE,
      approvalId: 'aid-8',
      args: { apiKey: 'sk-super-secret-123', to: 'a@b.c', body: 'hello' },
    });
    await flushMicro();
    const arg = web.chat.postMessage.mock.calls[0]![0] as {
      blocks: Array<{ text?: { text: string } }>;
    };
    const descText = arg.blocks[1]!.text!.text;
    expect(descText).toBe('Argument keys: apiKey, to, body');
    // Explicit absence of the secret value:
    expect(descText).not.toContain('sk-super-secret-123');
  });

  it('T-9: approve interaction → resolver resolves approved=true', async () => {
    const web = fakeWeb();
    const adapter = new SlackEditStreamingAdapter({
      web,
      channel: 'C1',
      fetchImpl: fakeFetch() as unknown as typeof fetch,
    });
    const resolver = adapter.approvalResolver();
    const p = resolver({ ...PREVIEW_BASE, approvalId: 'aid-9' });
    await flushMicro();
    await adapter.onInteraction({
      actionId: 'hipp0-approve:aid-9',
      responseUrl: 'https://hooks.slack.com/actions/T/1/x',
    });
    await expect(p).resolves.toEqual({ approvalId: 'aid-9', approved: true });
  });

  it('T-10: reject interaction → resolver resolves approved=false', async () => {
    const web = fakeWeb();
    const adapter = new SlackEditStreamingAdapter({
      web,
      channel: 'C1',
      fetchImpl: fakeFetch() as unknown as typeof fetch,
    });
    const resolver = adapter.approvalResolver();
    const p = resolver({ ...PREVIEW_BASE, approvalId: 'aid-10' });
    await flushMicro();
    await adapter.onInteraction({
      actionId: 'hipp0-reject:aid-10',
      responseUrl: 'https://hooks.slack.com/actions/T/1/x',
    });
    await expect(p).resolves.toEqual({ approvalId: 'aid-10', approved: false });
  });

  it('T-11: onInteraction POSTs to response_url with replace_original:true + empty blocks (DECISION 11-C)', async () => {
    const web = fakeWeb();
    const fetchImpl = fakeFetch();
    const adapter = new SlackEditStreamingAdapter({
      web,
      channel: 'C1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const resolver = adapter.approvalResolver();
    const p = resolver({ ...PREVIEW_BASE, approvalId: 'aid-11' });
    await flushMicro();
    const url = 'https://hooks.slack.com/actions/T1/1/hash-xyz';
    await adapter.onInteraction({ actionId: 'hipp0-approve:aid-11', responseUrl: url });
    await p;
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [calledUrl, init] = fetchImpl.mock.calls[0]!;
    expect(calledUrl).toBe(url);
    expect((init as { method: string }).method).toBe('POST');
    const body = JSON.parse((init as { body: string }).body) as Record<string, unknown>;
    expect(body['replace_original']).toBe(true);
    expect(body['blocks']).toEqual([]);
  });

  it('T-12: onInteraction ignores foreign action_id (no prefix match)', async () => {
    const web = fakeWeb();
    const fetchImpl = fakeFetch();
    const adapter = new SlackEditStreamingAdapter({
      web,
      channel: 'C1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const resolver = adapter.approvalResolver();
    let settled = false;
    const p = resolver({ ...PREVIEW_BASE, approvalId: 'real-12' }).then((d) => {
      settled = true;
      return d;
    });
    await flushMicro();
    await adapter.onInteraction({
      actionId: 'someone-elses-button',
      responseUrl: 'https://hooks.slack.com/actions/T/1/x',
    });
    await adapter.onInteraction({
      actionId: 'hipp0-approve:stale-id',
      responseUrl: 'https://hooks.slack.com/actions/T/1/x',
    });
    await flushMicro();
    expect(settled).toBe(false);
    // 'someone-elses-button' has no prefix → early return, no fetch.
    // 'hipp0-approve:stale-id' has prefix → fetch fires but the map lookup misses.
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await adapter.onInteraction({
      actionId: 'hipp0-reject:real-12',
      responseUrl: 'https://hooks.slack.com/actions/T/1/x',
    });
    await expect(p).resolves.toEqual({ approvalId: 'real-12', approved: false });
  });
});

// ─── parseBlockActionsPayload / isParsedSlackInteraction ────────────────────

describe('parseBlockActionsPayload / isParsedSlackInteraction', () => {
  it('T-13: extracts {actionId, responseUrl} from a real block_actions payload', () => {
    const payload = {
      type: 'block_actions',
      user: { id: 'U1', username: 'alice' },
      api_app_id: 'A1',
      team: { id: 'T1' },
      trigger_id: '123.456',
      response_url: 'https://hooks.slack.com/actions/T1/1/xyz',
      actions: [
        {
          action_id: 'hipp0-approve:abc',
          block_id: 'b1',
          value: 'v',
          type: 'button',
        },
      ],
      channel: { id: 'C1' },
    };
    const parsed = parseBlockActionsPayload(payload);
    expect(parsed).not.toBeNull();
    expect(parsed!.actionId).toBe('hipp0-approve:abc');
    expect(parsed!.responseUrl).toBe('https://hooks.slack.com/actions/T1/1/xyz');
  });

  it('T-14: returns null for non-block_actions payloads / missing fields', () => {
    expect(parseBlockActionsPayload(null)).toBeNull();
    expect(parseBlockActionsPayload('not an object')).toBeNull();
    expect(parseBlockActionsPayload({ type: 'message_action', actions: [] })).toBeNull();
    // Missing actions[]
    expect(parseBlockActionsPayload({ type: 'block_actions', response_url: 'u' })).toBeNull();
    // Empty actions[]
    expect(
      parseBlockActionsPayload({ type: 'block_actions', actions: [], response_url: 'u' }),
    ).toBeNull();
    // Missing action_id
    expect(
      parseBlockActionsPayload({
        type: 'block_actions',
        actions: [{ block_id: 'b' }],
        response_url: 'u',
      }),
    ).toBeNull();
    // Missing response_url
    expect(
      parseBlockActionsPayload({
        type: 'block_actions',
        actions: [{ action_id: 'a' }],
      }),
    ).toBeNull();
  });

  it('T-15: isParsedSlackInteraction accepts parsed shape, rejects raw payload', () => {
    expect(isParsedSlackInteraction({ actionId: 'a', responseUrl: 'u' })).toBe(true);
    // Raw payload has `actions` → must be rejected so onInteraction routes
    // it through parseBlockActionsPayload instead. PR #10 lesson #3.
    expect(
      isParsedSlackInteraction({
        actionId: 'a',
        responseUrl: 'u',
        actions: [],
      }),
    ).toBe(false);
    expect(isParsedSlackInteraction(null)).toBe(false);
    expect(isParsedSlackInteraction({ actionId: 'a' })).toBe(false);
  });

  it('T-16: onInteraction dispatches correctly for both parsed + raw inputs', async () => {
    const web = fakeWeb();
    const fetchImpl = fakeFetch();
    const adapter = new SlackEditStreamingAdapter({
      web,
      channel: 'C1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    // Parsed path
    const r1 = adapter.approvalResolver();
    const p1 = r1({ ...PREVIEW_BASE, approvalId: 'aid-16a' });
    await flushMicro();
    await adapter.onInteraction({
      actionId: 'hipp0-approve:aid-16a',
      responseUrl: 'https://hooks.slack.com/actions/T/1/a',
    });
    await expect(p1).resolves.toEqual({ approvalId: 'aid-16a', approved: true });
    // Raw path
    const r2 = adapter.approvalResolver();
    const p2 = r2({ ...PREVIEW_BASE, approvalId: 'aid-16b' });
    await flushMicro();
    await adapter.onInteraction({
      type: 'block_actions',
      actions: [{ action_id: 'hipp0-reject:aid-16b' }],
      response_url: 'https://hooks.slack.com/actions/T/1/b',
    });
    await expect(p2).resolves.toEqual({ approvalId: 'aid-16b', approved: false });
  });
});

// ─── Cleanup / pending-count ────────────────────────────────────────────────

describe('SlackEditStreamingAdapter — cleanup + pending lifecycle', () => {
  it('T-17: cleanup runs on all three paths (tap / resolver-rejects / settled)', async () => {
    // (a) tap — finally runs because the promise resolves
    {
      const web = fakeWeb();
      const adapter = new SlackEditStreamingAdapter({
        web,
        channel: 'C1',
        fetchImpl: fakeFetch() as unknown as typeof fetch,
      });
      const r = adapter.approvalResolver();
      const p = r({ ...PREVIEW_BASE, approvalId: 'aid-17a' });
      await flushMicro();
      expect(adapter._debugPendingCount()).toBe(1);
      await adapter.onInteraction({
        actionId: 'hipp0-approve:aid-17a',
        responseUrl: 'https://hooks.slack.com/actions/T/1/x',
      });
      await p;
      expect(adapter._debugPendingCount()).toBe(0);
    }
    // (b) resolver chain rejection — finally still runs
    {
      const web = fakeWeb();
      web.chat.postMessage.mockRejectedValueOnce(new Error('posted but we crashed on our side'));
      const adapter = new SlackEditStreamingAdapter({
        web,
        channel: 'C1',
        fetchImpl: fakeFetch() as unknown as typeof fetch,
      });
      const r = adapter.approvalResolver();
      // chat.postMessage rejects → resolver returns {approved:false, reason:'prompt-post-failed'}
      // without ever adding to #pending (the try-catch around postMessage is BEFORE
      // the pending Map set). So pendingCount is 0 throughout. That's the correct
      // contract: prompt-post-failed never creates a pending entry.
      await r({ ...PREVIEW_BASE, approvalId: 'aid-17b' });
      expect(adapter._debugPendingCount()).toBe(0);
    }
    // (c) two concurrent approvals resolve independently — cleanup is per-id
    {
      const web = fakeWeb();
      const adapter = new SlackEditStreamingAdapter({
        web,
        channel: 'C1',
        fetchImpl: fakeFetch() as unknown as typeof fetch,
      });
      const r = adapter.approvalResolver();
      const pA = r({ ...PREVIEW_BASE, approvalId: 'A' });
      const pB = r({ ...PREVIEW_BASE, approvalId: 'B' });
      await flushMicro();
      expect(adapter._debugPendingCount()).toBe(2);
      await adapter.onInteraction({
        actionId: 'hipp0-approve:A',
        responseUrl: 'https://hooks.slack.com/actions/T/1/a',
      });
      await pA;
      expect(adapter._debugPendingCount()).toBe(1);
      await adapter.onInteraction({
        actionId: 'hipp0-reject:B',
        responseUrl: 'https://hooks.slack.com/actions/T/1/b',
      });
      await pB;
      expect(adapter._debugPendingCount()).toBe(0);
    }
  });

  it('T-18: response_url POST failure is swallowed (fire-and-forget)', async () => {
    const web = fakeWeb();
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network died'));
    const adapter = new SlackEditStreamingAdapter({
      web,
      channel: 'C1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const r = adapter.approvalResolver();
    const p = r({ ...PREVIEW_BASE, approvalId: 'aid-18' });
    await flushMicro();
    // onInteraction must not throw even when response_url POST fails.
    await expect(
      adapter.onInteraction({
        actionId: 'hipp0-approve:aid-18',
        responseUrl: 'https://hooks.slack.com/actions/T/1/x',
      }),
    ).resolves.toBeUndefined();
    await expect(p).resolves.toEqual({ approvalId: 'aid-18', approved: true });
  });

  it('T-19: prompt-post failure → returns approved:false with prompt-post-failed reason', async () => {
    const web = fakeWeb();
    web.chat.postMessage.mockRejectedValueOnce(new Error('chat.postMessage down'));
    const adapter = new SlackEditStreamingAdapter({
      web,
      channel: 'C1',
      fetchImpl: fakeFetch() as unknown as typeof fetch,
    });
    const resolver = adapter.approvalResolver();
    const decision = await resolver({ ...PREVIEW_BASE, approvalId: 'aid-19' });
    expect(decision.approvalId).toBe('aid-19');
    expect(decision.approved).toBe(false);
    expect(decision.reason).toContain('prompt-post-failed');
    expect(decision.reason).toContain('chat.postMessage down');
  });

  it('T-20: late tap after cleanup → silent no-op (Map lookup miss)', async () => {
    const web = fakeWeb();
    const adapter = new SlackEditStreamingAdapter({
      web,
      channel: 'C1',
      fetchImpl: fakeFetch() as unknown as typeof fetch,
    });
    // No pending approval exists — tap does nothing.
    await expect(
      adapter.onInteraction({
        actionId: 'hipp0-approve:never-existed',
        responseUrl: 'https://hooks.slack.com/actions/T/1/x',
      }),
    ).resolves.toBeUndefined();
    expect(adapter._debugPendingCount()).toBe(0);
  });

  it('T-21: _debugPendingCount probe — late-tap-after-resolve scenario (distinct from T-17(a))', async () => {
    // T-17(a) asserts probe goes 1→0 on first tap. T-21 asserts a SECOND
    // tap with the same action_id after cleanup does NOT resurrect the
    // pending entry. This is structurally untestable via the public API
    // alone — the probe is the only way to observe leak-vs-no-leak
    // since the already-resolved promise can't be re-resolved.
    const web = fakeWeb();
    const adapter = new SlackEditStreamingAdapter({
      web,
      channel: 'C1',
      fetchImpl: fakeFetch() as unknown as typeof fetch,
    });
    expect(adapter._debugPendingCount()).toBe(0);
    const r = adapter.approvalResolver();
    const p = r({ ...PREVIEW_BASE, approvalId: 'aid-21' });
    await flushMicro();
    expect(adapter._debugPendingCount()).toBe(1);
    // t=0: first tap — resolves + cleans up
    await adapter.onInteraction({
      actionId: 'hipp0-approve:aid-21',
      responseUrl: 'https://hooks.slack.com/actions/T/1/x',
    });
    await p;
    expect(adapter._debugPendingCount()).toBe(0);
    // t=1: second tap with the same action_id — must stay at 0
    await adapter.onInteraction({
      actionId: 'hipp0-approve:aid-21',
      responseUrl: 'https://hooks.slack.com/actions/T/1/x',
    });
    expect(adapter._debugPendingCount()).toBe(0);
  });
});

// ─── Invariant (DECISION 11-F dead-branch claim) ────────────────────────────

describe('classifySlackError invariant', () => {
  it('T-22: no fixture in __fixtures__/slack-errors.json ever returns kind=absorb', () => {
    for (const name of Object.keys(FIXTURES)) {
      const err = slackErr(name as keyof typeof FIXTURES);
      const c = classifySlackError(err);
      expect(
        c.kind,
        `fixture "${name}" classified as ${c.kind}; absorb branch must stay dead per DECISION 11-F`,
      ).not.toBe('absorb');
    }
  });
});

// ─── Additional error / surface coverage ────────────────────────────────────

describe('SlackEditStreamingAdapter — additional error propagation', () => {
  it('T-23: #finalFormatEdit on permanent error throws kind=permanent (session will disable)', async () => {
    const web = fakeWeb();
    web.chat.update.mockRejectedValueOnce(slackErr('channelNotFound'));
    const adapter = new SlackEditStreamingAdapter({ web, channel: 'C1' });
    const { finalFormatEdit } = adapter.sessionOptions();
    await expect(finalFormatEdit!('1.0', 'text')).rejects.toMatchObject({
      name: 'StreamingEditError',
      kind: 'permanent',
    });
    // Exactly ONE chat.update call — the permanent classification does NOT
    // trigger the parse-error plain-text fallback.
    expect(web.chat.update).toHaveBeenCalledTimes(1);
  });
});

describe('classifySlackError — fixture mapping (DECISION 11-F)', () => {
  it.each([
    ['ratelimited', 'rate-limit', 2000] as const,
    ['channelNotFound', 'permanent', undefined] as const,
    ['invalidAuth', 'permanent', undefined] as const,
    ['missingScope', 'permanent', undefined] as const,
    ['msgTooLong', 'permanent', undefined] as const,
    ['fatalError', 'transient', undefined] as const,
    ['http429WithRetryAfter', 'rate-limit', 3000] as const,
    ['http502', 'transient', undefined] as const,
  ])('T-24: fixture %s → kind=%s (retryAfterMs=%s)', (name, kind, retryAfterMs) => {
    const c = classifySlackError(slackErr(name as keyof typeof FIXTURES));
    expect(c.kind).toBe('classified');
    if (c.kind === 'classified') {
      expect(c.error).toBeInstanceOf(StreamingEditError);
      expect(c.error.kind).toBe(kind);
      expect(c.error.retryAfterMs).toBe(retryAfterMs);
    }
  });

  it('T-25: network ECONNRESET → transient; non-Error throw → unknown', () => {
    const netErr = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const c = classifySlackError(netErr);
    expect(c.kind).toBe('classified');
    if (c.kind === 'classified') expect(c.error.kind).toBe('transient');
    // Non-Error throw (string, number, null, undefined)
    expect(classifySlackError('boom').kind).toBe('unknown');
    expect(classifySlackError(42).kind).toBe('unknown');
    expect(classifySlackError(null).kind).toBe('unknown');
    expect(classifySlackError(undefined).kind).toBe('unknown');
  });
});
