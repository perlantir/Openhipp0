/**
 * Slack `mrkdwn` escaper for the adapter's `finalFormatEdit` terminal pass.
 *
 * Two orthogonal rules (DECISION 11-B in CLAUDE.md):
 *
 *   1. **Entity escape `<`, `>`, `&` EVERYWHERE in input**, including inside
 *      backtick-delimited code spans. Slack's parser treats raw angle
 *      brackets and ampersands as HTML-entity-like markup and drops/mangles
 *      them even inside `code`. Literal `<T>` inside backticks therefore
 *      escapes to `&lt;T&gt;` — Go/Rust/C++ generics, JSX, inline HTML all
 *      render correctly.
 *
 *   2. **Syntax transformation applies OUTSIDE code spans only.** CommonMark
 *      `**bold**` → mrkdwn `*bold*`, `*italic*` → `_italic_`,
 *      `[text](url)` → `<url|text>`, and bare `_` → `\_`. Inside backticks
 *      the raw characters of those markers are left literal (they're code,
 *      not formatting).
 *
 *   3. **Triple-backtick fences + single-backtick inline code pass through
 *      on the syntax axis** (DECISION 11-I). Slack renders both correctly
 *      in `mrkdwn` text payloads. Converting triple-backticks to single
 *      collapses multi-line code into an inline span — visibly broken.
 *
 * Link URL pipe-encoding (T-m6 / DECISION 11-B pushback 1):
 *   The mrkdwn link syntax `<url|text>` uses `|` as the delimiter. A literal
 *   `|` inside the URL collides with that delimiter. URL-encoded to `%7C` —
 *   always safe, unambiguous, and never changes rendering (URL pipes render
 *   identically when percent-encoded).
 *
 * Bare underscore escape (T-m10):
 *   Slack's italic uses `_text_`. Identifiers like `foo_bar` in prose could
 *   be mis-italicized when `_` happens to fall at a word boundary. Bare `_`
 *   (one not part of a matched `_text_` pair on the same line) is backslash-
 *   escaped to `\_`. A paired italic `_foo_` in input passes through as
 *   `_foo_`.
 */

const ENTITY_MAP: Record<string, string> = { '<': '&lt;', '>': '&gt;', '&': '&amp;' };

function entityEscape(s: string): string {
  return s.replace(/[<>&]/g, (c) => ENTITY_MAP[c] ?? c);
}

type Segment =
  | { readonly kind: 'prose'; readonly text: string }
  | { readonly kind: 'code'; readonly delim: '`' | '```'; readonly content: string };

/**
 * Segment input into alternating prose / code regions. Code regions are:
 *   - triple-backtick fences: ```...``` (multi-line, non-greedy close)
 *   - single-backtick spans:  `...` (must close on same line)
 *
 * Unclosed backtick runs fall through to prose (literal characters), matching
 * CommonMark behavior and avoiding ever dropping input.
 */
function segmentInput(input: string): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  let proseStart = 0;
  const flushProse = (end: number): void => {
    if (end > proseStart) out.push({ kind: 'prose', text: input.slice(proseStart, end) });
  };
  while (i < input.length) {
    if (input.startsWith('```', i)) {
      const end = input.indexOf('```', i + 3);
      if (end !== -1) {
        flushProse(i);
        out.push({ kind: 'code', delim: '```', content: input.slice(i + 3, end) });
        i = end + 3;
        proseStart = i;
        continue;
      }
      // Unclosed fence — advance past the opening delim and keep scanning.
      i += 3;
      continue;
    }
    if (input[i] === '`') {
      const end = input.indexOf('`', i + 1);
      if (end !== -1 && input.slice(i + 1, end).indexOf('\n') === -1) {
        flushProse(i);
        out.push({ kind: 'code', delim: '`', content: input.slice(i + 1, end) });
        i = end + 1;
        proseStart = i;
        continue;
      }
      // Unclosed or newline-crossing single-backtick — treat as prose.
    }
    i++;
  }
  flushProse(input.length);
  return out;
}

/**
 * Walks a prose region left-to-right, matching CommonMark constructs and
 * emitting mrkdwn equivalents. Entity-escape applies inline on every emitted
 * non-synthetic `<`/`>`/`&` character (synthetic `<` / `|` / `>` from link
 * transformation are skipped — they're delimiters we just created).
 *
 * Order of matches at each position:
 *   1. `[text](url)` link (with one level of paren nesting in url)
 *   2. `**bold**`
 *   3. `*italic*` (single asterisk, not **)
 *   4. `_italic_` (passthrough; Slack's native italic)
 *   5. bare `_`          → `\_`
 *   6. `<`/`>`/`&`       → entity escape
 *   7. otherwise literal
 */
function transformProse(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;

    // [text](url)
    if (ch === '[') {
      const closeBracket = s.indexOf(']', i + 1);
      if (
        closeBracket !== -1 &&
        s[closeBracket + 1] === '(' &&
        s.slice(i + 1, closeBracket).indexOf('\n') === -1
      ) {
        let depth = 1;
        let j = closeBracket + 2;
        let closed = -1;
        while (j < s.length) {
          const cj = s[j]!;
          if (cj === '\n') break;
          if (cj === '(') depth++;
          else if (cj === ')') {
            depth--;
            if (depth === 0) {
              closed = j;
              break;
            }
          }
          j++;
        }
        if (closed !== -1) {
          const text = s.slice(i + 1, closeBracket);
          const url = s.slice(closeBracket + 2, closed);
          // URL-encode pipes (PR 1): `|` collides with the `<url|text>` delim.
          const safeUrl = url.replace(/\|/g, '%7C');
          out += '<' + safeUrl + '|' + entityEscape(text) + '>';
          i = closed + 1;
          continue;
        }
      }
    }

    // **bold**
    if (ch === '*' && s[i + 1] === '*') {
      const end = s.indexOf('**', i + 2);
      if (end !== -1 && end > i + 2 && s.slice(i + 2, end).indexOf('\n') === -1) {
        out += '*' + entityEscape(s.slice(i + 2, end)) + '*';
        i = end + 2;
        continue;
      }
    }

    // *italic* (single asterisk, not ** — and closing asterisk must not be **)
    if (ch === '*' && s[i + 1] !== '*') {
      const end = s.indexOf('*', i + 1);
      if (
        end !== -1 &&
        end > i + 1 &&
        s[end + 1] !== '*' &&
        s.slice(i + 1, end).indexOf('\n') === -1
      ) {
        out += '_' + entityEscape(s.slice(i + 1, end)) + '_';
        i = end + 1;
        continue;
      }
    }

    // _italic_ (passthrough) OR bare `_` → escape
    if (ch === '_') {
      const end = s.indexOf('_', i + 1);
      if (end !== -1 && end > i + 1 && s.slice(i + 1, end).indexOf('\n') === -1) {
        out += '_' + entityEscape(s.slice(i + 1, end)) + '_';
        i = end + 1;
        continue;
      }
      out += '\\_';
      i++;
      continue;
    }

    // Entity escape bare `<`, `>`, `&`
    if (ch === '<' || ch === '>' || ch === '&') {
      out += ENTITY_MAP[ch];
      i++;
      continue;
    }

    out += ch;
    i++;
  }
  return out;
}

export function escapeSlackMrkdwn(input: string): string {
  if (input.length === 0) return '';
  const segments = segmentInput(input);
  let result = '';
  for (const seg of segments) {
    if (seg.kind === 'code') {
      result += seg.delim + entityEscape(seg.content) + seg.delim;
    } else {
      result += transformProse(seg.text);
    }
  }
  return result;
}
