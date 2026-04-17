/**
 * MarkdownV2 escaper for Telegram's terminal/final edit.
 *
 * Strategy (DECISION 3 in CLAUDE.md Phase G2-b adapters):
 *   Preserve known formatting constructs, literal-escape everything
 *   else. We tokenize the input into alternating plain / formatted
 *   segments and apply the appropriate escape rule per segment.
 *
 * Known constructs (matching what `core/streaming.formatStreamEvent`
 * can emit):
 *   - triple-backtick code blocks: ```...```
 *   - inline code: `...`
 *   - bold: *...*
 *   - italic: _..._
 *   - link: [text](url)
 *
 * Per Telegram docs, MarkdownV2 escape rules:
 *   - Outside formatting: escape `_*[]()~`>#+-=|{}.!` with `\`.
 *   - Inside `pre` / `code`: escape only ``` ` ``` and `\`.
 *   - Inside link URL `(...)`: escape only `)` and `\`.
 *   - Inside `*bold*` / `_italic_`: escape like plain text (the
 *     wrapping delimiter itself is the format marker). Nested
 *     formatting inside bold/italic is NOT preserved — the content
 *     is treated as prose and all specials literal-escape. Keeps the
 *     parser simple; nested cases are rare in `formatStreamEvent`
 *     output.
 *
 * Unbalanced delimiters (e.g. single `*` in the middle of a
 * sentence) don't match the regex, so they fall through to the plain
 * escape path and render as literal `\*`. Predictable; no 400 from
 * Telegram.
 */

const SPECIALS = '_*[]()~`>#+-=|{}.!';
const SPECIALS_SET = new Set<string>([...SPECIALS]);

function escapePlain(s: string): string {
  let out = '';
  for (const ch of s) {
    if (SPECIALS_SET.has(ch)) out += '\\';
    out += ch;
  }
  return out;
}

function escapeCodeContent(s: string): string {
  return s.replace(/[`\\]/g, (m) => '\\' + m);
}

function escapeUrl(s: string): string {
  return s.replace(/[)\\]/g, (m) => '\\' + m);
}

/**
 * Matches formatting constructs in priority order:
 *   1. Triple-backtick block  ```...```  (greedy-minimal; spans newlines)
 *   2. Inline code            `...`      (no newline, 1+ chars)
 *   3. Bold                   *...*      (no newline, 1+ chars)
 *   4. Italic                 _..._      (no newline, 1+ chars)
 *   5. Link                   [text](url)
 */
const TOKEN_RE =
  /(```[\s\S]*?```)|(`[^`\n]+?`)|(\*[^*\n]+?\*)|(_[^_\n]+?_)|(\[[^\]\n]+?\]\([^)\n]+?\))/g;

export function escapeMarkdownV2(text: string): string {
  if (text.length === 0) return '';
  let result = '';
  let lastIdx = 0;
  TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    result += escapePlain(text.slice(lastIdx, m.index));
    const full = m[0];
    const tripleCode = m[1];
    const inlineCode = m[2];
    const bold = m[3];
    const italic = m[4];
    const link = m[5];
    if (tripleCode !== undefined) {
      result += '```' + escapeCodeContent(tripleCode.slice(3, -3)) + '```';
    } else if (inlineCode !== undefined) {
      result += '`' + escapeCodeContent(inlineCode.slice(1, -1)) + '`';
    } else if (bold !== undefined) {
      result += '*' + escapePlain(bold.slice(1, -1)) + '*';
    } else if (italic !== undefined) {
      result += '_' + escapePlain(italic.slice(1, -1)) + '_';
    } else if (link !== undefined) {
      const closeBracket = link.indexOf(']');
      const openParen = link.indexOf('(', closeBracket);
      const txt = link.slice(1, closeBracket);
      const url = link.slice(openParen + 1, -1);
      result += '[' + escapePlain(txt) + '](' + escapeUrl(url) + ')';
    } else {
      result += escapePlain(full);
    }
    lastIdx = m.index + full.length;
  }
  result += escapePlain(text.slice(lastIdx));
  return result;
}
