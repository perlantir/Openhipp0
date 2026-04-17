/**
 * Overflow helper. Pure string/byte math.
 *
 * When the running accumulated text grows past `maxBytes`, we rotate:
 * keep the prefix under the cap in the current message (to be final-
 * formatted independently — see DECISION 1 AFFECTS), and start the
 * next message with the overflow tail. Splits at the last `\n` within
 * the keep-window when available; hard-cuts at `maxBytes` otherwise.
 *
 * Byte-length is computed against the UTF-8 encoding — Telegram's 4096
 * cap is character-count, Discord's 2000 is character-count, Slack's
 * 40 000 is byte-count. Callers set `maxBytes` to the appropriate unit
 * and supply a pre-measured string length if they want
 * character-counting (no unicode normalization here).
 */

export interface RotateInput {
  readonly current: string;
  readonly maxBytes: number;
}

export type RotateResult =
  | { readonly fits: true; readonly text: string }
  | { readonly fits: false; readonly keep: string; readonly carry: string };

export function rotateOnOverflow(input: RotateInput): RotateResult {
  const bytes = utf8ByteLength(input.current);
  if (bytes <= input.maxBytes) {
    return { fits: true, text: input.current };
  }
  // Find the largest prefix whose UTF-8 byte-length is ≤ maxBytes.
  const keepEndBytes = input.maxBytes;
  let keepEndChars = 0;
  let running = 0;
  for (let i = 0; i < input.current.length; i++) {
    const cp = input.current.codePointAt(i)!;
    const charBytes = byteLenOf(cp);
    if (cp > 0xffff) i++; // surrogate pair: advance past the low surrogate
    if (running + charBytes > keepEndBytes) break;
    running += charBytes;
    keepEndChars = i + 1;
  }
  const hardPrefix = input.current.slice(0, keepEndChars);
  const hardCarry = input.current.slice(keepEndChars);
  // Prefer splitting at the last `\n` within the hardPrefix (cleaner UX).
  const lastNewline = hardPrefix.lastIndexOf('\n');
  if (lastNewline >= 0 && lastNewline >= hardPrefix.length - 1024) {
    // Only honor the newline if it's near the end — otherwise we'd
    // waste too much capacity per rotation.
    const keep = hardPrefix.slice(0, lastNewline);
    const carry = hardPrefix.slice(lastNewline + 1) + hardCarry;
    return { fits: false, keep, carry };
  }
  return { fits: false, keep: hardPrefix, carry: hardCarry };
}

function utf8ByteLength(s: string): number {
  // Fast path for ASCII.
  let asciiOnly = true;
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) > 0x7f) {
      asciiOnly = false;
      break;
    }
  }
  if (asciiOnly) return s.length;
  return Buffer.byteLength(s, 'utf8');
}

function byteLenOf(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}
