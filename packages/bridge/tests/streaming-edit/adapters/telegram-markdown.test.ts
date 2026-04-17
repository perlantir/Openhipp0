import { describe, expect, it } from 'vitest';

import { escapeMarkdownV2 } from '../../../src/streaming-edit/adapters/telegram-markdown.js';

describe('escapeMarkdownV2', () => {
  it('empty string → empty string', () => {
    expect(escapeMarkdownV2('')).toBe('');
  });

  it('escapes all MarkdownV2 special chars in plain text', () => {
    const specials = '_*[]()~`>#+-=|{}.!';
    const escaped = escapeMarkdownV2(specials);
    // Every special char gets a preceding backslash.
    expect(escaped).toBe(specials.split('').map((c) => '\\' + c).join(''));
  });

  it('preserves balanced *bold*', () => {
    expect(escapeMarkdownV2('hello *world* goodbye')).toBe('hello *world* goodbye');
  });

  it('preserves balanced _italic_', () => {
    expect(escapeMarkdownV2('see _this_ here')).toBe('see _this_ here');
  });

  it('preserves inline `code`; specials inside are NOT escaped (only ` and \\)', () => {
    expect(escapeMarkdownV2('run `x.y=1` now')).toBe('run `x.y=1` now');
  });

  it('preserves triple-backtick code blocks with raw internal content', () => {
    const src = '```\nconst x = 1; // .!*\n```';
    expect(escapeMarkdownV2(src)).toBe(src);
  });

  it('preserves [text](url); escapes specials in text, only escapes ) + \\ in url', () => {
    expect(escapeMarkdownV2('visit [the docs](https://example.com/path.html)')).toBe(
      'visit [the docs](https://example.com/path.html)',
    );
  });

  it('unbalanced * falls through to literal \\*', () => {
    expect(escapeMarkdownV2('5 * 7 = 35')).toBe('5 \\* 7 \\= 35');
  });

  it('specials inside balanced *bold* are still escaped', () => {
    expect(escapeMarkdownV2('*foo.bar*')).toBe('*foo\\.bar*');
  });

  it('real LLM-shaped sample: prose + code + bold + link round-trips cleanly', () => {
    const src =
      'Result: the *primary* endpoint is `GET /api/v1` — see [docs](https://example.com/docs).';
    const out = escapeMarkdownV2(src);
    // Bold preserved, inline-code content raw, link text+url preserved,
    // literal `.` + `:` + `/` (`/` isn't special) escaped in plain text.
    expect(out).toBe(
      'Result: the *primary* endpoint is `GET /api/v1` — see [docs](https://example.com/docs)\\.',
    );
  });
});
