import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GrammyError } from 'grammy';
import { describe, expect, it, vi } from 'vitest';

import {
  TelegramEditStreamingAdapter,
  classifyTelegramError,
  parseCallbackQuery,
} from '../../../src/streaming-edit/adapters/telegram.js';
import { StreamingEditError } from '../../../src/streaming-edit/types.js';

const FIXTURES = JSON.parse(
  readFileSync(
    resolve(fileURLToPath(new URL('./__fixtures__/telegram-errors.json', import.meta.url))),
    'utf8',
  ),
) as Record<
  string,
  { ok: false; error_code: number; description: string; parameters?: { retry_after?: number } }
>;

function grammyErr(name: keyof typeof FIXTURES): GrammyError {
  const fx = FIXTURES[name]!;
  return new GrammyError(fx.description, fx, 'editMessageText', {});
}

/** Minimal fake of the grammY Bot we need. */
function fakeBot() {
  const api = {
    sendMessage: vi.fn(),
    editMessageText: vi.fn(),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
  };
  return { api } as unknown as Parameters<typeof TelegramEditStreamingAdapter>[0]['bot'] & {
    api: typeof api;
  };
}

describe('classifyTelegramError', () => {
  it('429 with parameters.retry_after → rate-limit with retryAfterMs in ms', () => {
    const res = classifyTelegramError(grammyErr('rateLimit'));
    expect(res).toBeInstanceOf(StreamingEditError);
    if (res instanceof StreamingEditError) {
      expect(res.kind).toBe('rate-limit');
      expect(res.retryAfterMs).toBe(2000);
    }
  });

  it('400 "message is not modified" → absorb (silent no-op)', () => {
    expect(classifyTelegramError(grammyErr('notModified'))).toBe('absorb');
  });

  it('400 "can\'t parse entities" → parse-error', () => {
    const res = classifyTelegramError(grammyErr('parseEntities'));
    expect(res).toBeInstanceOf(StreamingEditError);
    if (res instanceof StreamingEditError) expect(res.kind).toBe('parse-error');
  });

  it('400 "message to edit not found" → permanent', () => {
    const res = classifyTelegramError(grammyErr('messageNotFound'));
    expect(res).toBeInstanceOf(StreamingEditError);
    if (res instanceof StreamingEditError) expect(res.kind).toBe('permanent');
  });

  it('403 "bot was blocked" → permanent', () => {
    const res = classifyTelegramError(grammyErr('botBlocked'));
    expect(res).toBeInstanceOf(StreamingEditError);
    if (res instanceof StreamingEditError) expect(res.kind).toBe('permanent');
  });

  it('502 Bad Gateway → transient', () => {
    const res = classifyTelegramError(grammyErr('badGateway'));
    expect(res).toBeInstanceOf(StreamingEditError);
    if (res instanceof StreamingEditError) expect(res.kind).toBe('transient');
  });

  it('ECONNRESET (network) → transient', () => {
    const e = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const res = classifyTelegramError(e);
    expect(res).toBeInstanceOf(StreamingEditError);
    if (res instanceof StreamingEditError) expect(res.kind).toBe('transient');
  });

  it('unknown 4xx shape → transient (safe default)', () => {
    const res = classifyTelegramError(grammyErr('unknownShape'));
    expect(res).toBeInstanceOf(StreamingEditError);
    if (res instanceof StreamingEditError) expect(res.kind).toBe('transient');
  });
});

describe('parseCallbackQuery', () => {
  it('extracts data + id from grammY-shaped callback context', () => {
    const ctx = { callbackQuery: { data: 'hipp0-approve:abc', id: '12345' } };
    expect(parseCallbackQuery(ctx)).toEqual({ data: 'hipp0-approve:abc', id: '12345' });
  });

  it('returns null when fields are missing', () => {
    expect(parseCallbackQuery({ callbackQuery: { id: '1' } })).toBeNull();
    expect(parseCallbackQuery({})).toBeNull();
  });
});

describe('TelegramEditStreamingAdapter — sessionOptions callbacks', () => {
  it('editFn passes through message id + text to bot.api.editMessageText', async () => {
    const bot = fakeBot();
    bot.api.editMessageText.mockResolvedValue({});
    const adapter = new TelegramEditStreamingAdapter({ bot, chatId: 1001 });
    const { editFn } = adapter.sessionOptions();
    await editFn('555', 'hello world');
    expect(bot.api.editMessageText).toHaveBeenCalledWith(1001, 555, 'hello world');
  });

  it('editFn on 429 → throws StreamingEditError rate-limit', async () => {
    const bot = fakeBot();
    bot.api.editMessageText.mockRejectedValue(grammyErr('rateLimit'));
    const adapter = new TelegramEditStreamingAdapter({ bot, chatId: 1001 });
    const { editFn } = adapter.sessionOptions();
    await expect(editFn('1', 'x')).rejects.toMatchObject({
      name: 'StreamingEditError',
      kind: 'rate-limit',
      retryAfterMs: 2000,
    });
  });

  it('editFn on "not modified" → resolves silently (no throw)', async () => {
    const bot = fakeBot();
    bot.api.editMessageText.mockRejectedValue(grammyErr('notModified'));
    const adapter = new TelegramEditStreamingAdapter({ bot, chatId: 1001 });
    const { editFn } = adapter.sessionOptions();
    await expect(editFn('1', 'x')).resolves.toBeUndefined();
  });

  it('sendFn returns string message_id from grammY response', async () => {
    const bot = fakeBot();
    bot.api.sendMessage.mockResolvedValue({ message_id: 9001 });
    const adapter = new TelegramEditStreamingAdapter({ bot, chatId: 'grp-2' });
    const { sendFn } = adapter.sessionOptions();
    await expect(sendFn('rotated text')).resolves.toBe('9001');
    expect(bot.api.sendMessage).toHaveBeenCalledWith('grp-2', 'rotated text');
  });

  it('sessionOptions reports maxMessageBytes = 4096 + default debounceMs = 1000', () => {
    const adapter = new TelegramEditStreamingAdapter({ bot: fakeBot(), chatId: 1 });
    const opts = adapter.sessionOptions();
    expect(opts.maxMessageBytes).toBe(4096);
    expect(opts.debounceMs).toBe(1000);
  });
});

describe('TelegramEditStreamingAdapter — finalFormatEdit', () => {
  it('sends with parse_mode: MarkdownV2 and escaped text', async () => {
    const bot = fakeBot();
    bot.api.editMessageText.mockResolvedValue({});
    const adapter = new TelegramEditStreamingAdapter({ bot, chatId: 1 });
    const { finalFormatEdit } = adapter.sessionOptions();
    await finalFormatEdit!('42', 'hi. see *this*');
    // Escaped: `.` → `\.`, bold preserved.
    expect(bot.api.editMessageText).toHaveBeenCalledWith(1, 42, 'hi\\. see *this*', {
      parse_mode: 'MarkdownV2',
    });
  });

  it('on parse-error → retries ONCE without parse_mode', async () => {
    const bot = fakeBot();
    bot.api.editMessageText
      .mockRejectedValueOnce(grammyErr('parseEntities'))
      .mockResolvedValueOnce({});
    const adapter = new TelegramEditStreamingAdapter({ bot, chatId: 1 });
    const { finalFormatEdit } = adapter.sessionOptions();
    await expect(finalFormatEdit!('42', 'bad.md')).resolves.toBeUndefined();
    expect(bot.api.editMessageText).toHaveBeenCalledTimes(2);
    // Second call: raw plain text, no parse_mode option.
    expect(bot.api.editMessageText).toHaveBeenLastCalledWith(1, 42, 'bad.md');
  });

  it('rethrows permanent errors that occur on the MarkdownV2 attempt', async () => {
    const bot = fakeBot();
    bot.api.editMessageText.mockRejectedValue(grammyErr('messageNotFound'));
    const adapter = new TelegramEditStreamingAdapter({ bot, chatId: 1 });
    const { finalFormatEdit } = adapter.sessionOptions();
    await expect(finalFormatEdit!('42', 'x')).rejects.toMatchObject({
      name: 'StreamingEditError',
      kind: 'permanent',
    });
  });
});

describe('TelegramEditStreamingAdapter — approvalResolver + callback flow', () => {
  it('posts inline_keyboard with approve/reject buttons carrying approvalId', async () => {
    const bot = fakeBot();
    bot.api.sendMessage.mockResolvedValue({ message_id: 777 });
    const adapter = new TelegramEditStreamingAdapter({ bot, chatId: 500 });
    const resolver = adapter.approvalResolver();
    const preview = {
      kind: 'tool-call-preview' as const,
      turnId: 't',
      at: 'a',
      toolName: 'send_email',
      args: {},
      previewStrategy: 'preview-approval' as const,
      approvalId: 'app-xyz',
    };
    const p = resolver(preview);
    // Give grammY sendMessage a tick to be called.
    await Promise.resolve();
    await Promise.resolve();
    expect(bot.api.sendMessage).toHaveBeenCalledOnce();
    const [chatArg, textArg, optsArg] = bot.api.sendMessage.mock.calls[0]!;
    expect(chatArg).toBe(500);
    expect(textArg).toContain('send_email');
    // Inline keyboard present with our prefixed callback_data.
    const kb = (optsArg as { reply_markup: { inline_keyboard: [{ callback_data: string }][] } })
      .reply_markup.inline_keyboard;
    expect(kb[0]![0]!.callback_data).toBe('hipp0-approve:app-xyz');
    expect(kb[0]![1]!.callback_data).toBe('hipp0-reject:app-xyz');
    // Dispatch approve tap → resolver resolves approved=true.
    await adapter.onCallbackQuery({ data: 'hipp0-approve:app-xyz', id: 'q1' });
    const decision = await p;
    expect(decision).toEqual({ approvalId: 'app-xyz', approved: true });
    // Cleanup stripped the keyboard.
    expect(bot.api.editMessageReplyMarkup).toHaveBeenCalledWith(500, 777, {
      reply_markup: undefined,
    });
  });

  it('callback for a different approvalId is ignored; resolver stays pending', async () => {
    const bot = fakeBot();
    bot.api.sendMessage.mockResolvedValue({ message_id: 10 });
    const adapter = new TelegramEditStreamingAdapter({ bot, chatId: 1 });
    const resolver = adapter.approvalResolver();
    const preview = {
      kind: 'tool-call-preview' as const,
      turnId: 't',
      at: 'a',
      toolName: 'x',
      args: {},
      previewStrategy: 'preview-approval' as const,
      approvalId: 'real',
    };
    let settled = false;
    const p = resolver(preview).then((d) => {
      settled = true;
      return d;
    });
    await Promise.resolve();
    await Promise.resolve();
    // Unrelated callback — different approvalId.
    await adapter.onCallbackQuery({ data: 'hipp0-approve:stale', id: 'q2' });
    await Promise.resolve();
    expect(settled).toBe(false);
    // Now the real one.
    await adapter.onCallbackQuery({ data: 'hipp0-reject:real', id: 'q3' });
    await expect(p).resolves.toEqual({ approvalId: 'real', approved: false });
  });
});
