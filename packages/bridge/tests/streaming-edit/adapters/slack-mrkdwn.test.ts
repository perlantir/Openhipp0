/**
 * Tests for `escapeSlackMrkdwn` — PR #11 DECISIONs 11-B and 11-I.
 *
 * The escaper has two orthogonal rules:
 *   (1) entity-escape `<`/`>`/`&` EVERYWHERE, including inside code spans
 *   (2) CommonMark → mrkdwn syntax transformation OUTSIDE code spans only
 *
 * T-m13 is the round-trip anchor: if it passes, the individual rules work
 * together under realistic mixed content (PR #11 reviewer pushback 3). If
 * T-m13 fails, start there — interaction bugs surface before atomic rules.
 */

import { describe, expect, it } from 'vitest';

import { escapeSlackMrkdwn } from '../../../src/streaming-edit/adapters/slack-mrkdwn.js';

describe('escapeSlackMrkdwn', () => {
  it('T-m1: **bold** CommonMark → *bold* Slack (prose only)', () => {
    expect(escapeSlackMrkdwn('see **this text** now')).toBe('see *this text* now');
  });

  it('T-m2: *italic* CommonMark → _italic_ Slack (prose only)', () => {
    expect(escapeSlackMrkdwn('see *this text* now')).toBe('see _this text_ now');
  });

  it('T-m3: `code` with no special chars passes through unchanged', () => {
    expect(escapeSlackMrkdwn('see `code` now')).toBe('see `code` now');
  });

  it('T-m4: [text](url) → <url|text>', () => {
    expect(escapeSlackMrkdwn('see [the docs](https://example.com) here')).toBe(
      'see <https://example.com|the docs> here',
    );
  });

  it('T-m5: Wikipedia URL with nested parens escapes correctly (PR #9 lesson #1)', () => {
    // The original PR #9 Telegram escaper broke on links whose URL body had
    // nested parens. Slack's two-pass version must NOT repeat that bug.
    expect(
      escapeSlackMrkdwn('read [Foo](https://en.wikipedia.org/wiki/Foo_(bar)) today'),
    ).toBe('read <https://en.wikipedia.org/wiki/Foo_(bar)|Foo> today');
  });

  it('T-m6: URL containing pipe → pipe URL-encoded to %7C, never raw | (DECISION 11-B pushback 1)', () => {
    const out = escapeSlackMrkdwn('see [here](https://x.com/?a=b|c) now');
    expect(out).toContain('%7C');
    // No raw pipe in the URL position (there's still exactly one pipe — the
    // delimiter between url and text — so we check that the URL body itself
    // has no raw pipe).
    const urlPart = out.slice(out.indexOf('<') + 1, out.indexOf('|'));
    expect(urlPart).not.toContain('|');
    expect(out).toBe('see <https://x.com/?a=b%7Cc|here> now');
  });

  it('T-m7: bare `<`, `>`, `&` in prose entity-escape to &lt; &gt; &amp;', () => {
    expect(escapeSlackMrkdwn('a<b>c&d')).toBe('a&lt;b&gt;c&amp;d');
  });

  it('T-m8: angle-bracketed generic <T> inside a code span IS entity-escaped (BLOCKER fix)', () => {
    // This is the semantic the reviewer caught as backwards in the initial
    // plan. Slack's parser entity-mangles `<` and `>` INSIDE backticks too;
    // only the SYNTAX transformation (e.g. not converting `**bold**` inside
    // backticks) is suppressed. Entity escaping always applies.
    expect(escapeSlackMrkdwn('use `<T>` here')).toBe('use `&lt;T&gt;` here');
    // Inside a single-backtick span, the formatting markers stay literal —
    // `**not bold**` inside backticks should NOT become `*not bold*`.
    expect(escapeSlackMrkdwn('use `**not bold**` here')).toBe('use `**not bold**` here');
  });

  it('T-m9: triple-backtick fences pass through on syntax axis; entity-escape still applies inside (DECISION 11-I)', () => {
    // Multi-line fenced block — preserved as a triple-backtick span, NOT
    // collapsed to a single-backtick inline span. Inside, `<T>` is still
    // entity-escaped so generics render correctly.
    const input = '```ts\nfunction f<T>(x: T): T { return x }\n```';
    const expected = '```ts\nfunction f&lt;T&gt;(x: T): T { return x }\n```';
    expect(escapeSlackMrkdwn(input)).toBe(expected);
  });

  it('T-m10: bare `_` in `foo_bar` prose → `foo\\_bar`; inside code span stays literal', () => {
    expect(escapeSlackMrkdwn('use foo_bar here')).toBe('use foo\\_bar here');
    // Inside a code span, the underscore is NOT escaped (code spans
    // suppress syntax transformation including the bare-underscore rule).
    expect(escapeSlackMrkdwn('use `foo_bar` here')).toBe('use `foo_bar` here');
  });

  it('T-m11: empty input → empty output', () => {
    expect(escapeSlackMrkdwn('')).toBe('');
  });

  it('T-m12: unclosed marker `*bold` falls through to literal, no render failure', () => {
    // No matching close `*` on the same line → italic rule doesn't fire;
    // the `*` emits as a literal asterisk. Predictable, no exception.
    expect(escapeSlackMrkdwn('say *bold without end')).toBe('say *bold without end');
    expect(() => escapeSlackMrkdwn('say *bold without end')).not.toThrow();
  });

  it('T-m13: round-trip mixed-content agent response (PR #11 reviewer pushback 3 anchor)', () => {
    // Combines every rule: bold + italic + inline code + link + triple-
    // backtick fence with <generics> inside + bare <T> + `&` + bare `_`.
    // If T-m1..T-m12 pass but T-m13 fails, the failure is an interaction
    // between rules, not an individual-rule bug.
    const input =
      'Here is **bold**, *italic*, `inline code`, and a [link](https://example.com).\n' +
      '\n' +
      '```ts\n' +
      'function Generic<T>(x: T): T {\n' +
      '  return x;\n' +
      '}\n' +
      '```\n' +
      '\n' +
      'Also note: bare <T> generic in prose & a test_identifier.\n';
    const expected =
      'Here is *bold*, _italic_, `inline code`, and a <https://example.com|link>.\n' +
      '\n' +
      '```ts\n' +
      'function Generic&lt;T&gt;(x: T): T {\n' +
      '  return x;\n' +
      '}\n' +
      '```\n' +
      '\n' +
      'Also note: bare &lt;T&gt; generic in prose &amp; a test\\_identifier.\n';
    expect(escapeSlackMrkdwn(input)).toBe(expected);
  });
});
