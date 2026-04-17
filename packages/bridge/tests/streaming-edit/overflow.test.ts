import { describe, expect, it } from 'vitest';

import { rotateOnOverflow } from '../../src/streaming-edit/overflow.js';

describe('rotateOnOverflow', () => {
  it('under maxBytes returns { fits:true, text } unchanged', () => {
    const result = rotateOnOverflow({ current: 'hello world', maxBytes: 100 });
    expect(result).toEqual({ fits: true, text: 'hello world' });
  });

  it('over maxBytes splits at last newline within window, else hard-cuts', () => {
    // Newline case — prefers the newline split.
    const withNewline = 'line one\nline two\nline three extra content';
    const res1 = rotateOnOverflow({ current: withNewline, maxBytes: 22 });
    expect(res1.fits).toBe(false);
    if (!res1.fits) {
      expect(res1.keep.endsWith('line two')).toBe(true);
      expect(res1.keep.includes('\n')).toBe(true);
      expect(res1.carry.length).toBeGreaterThan(0);
    }

    // Hard-cut case — no newlines at all, single string.
    const noNewline = 'a'.repeat(50);
    const res2 = rotateOnOverflow({ current: noNewline, maxBytes: 20 });
    expect(res2.fits).toBe(false);
    if (!res2.fits) {
      expect(res2.keep.length).toBe(20);
      expect(res2.carry.length).toBe(30);
    }

    // Multi-byte UTF-8 boundary safety — 2-byte chars (pound sign).
    const utf8 = '£'.repeat(20); // 20 × 2 bytes = 40 bytes
    const res3 = rotateOnOverflow({ current: utf8, maxBytes: 10 });
    expect(res3.fits).toBe(false);
    if (!res3.fits) {
      // Should keep 5 pounds (10 bytes), carry 15.
      expect(res3.keep.length).toBe(5);
      expect(res3.carry.length).toBe(15);
    }
  });

  it('never cuts mid-codepoint for 4-byte UTF-8 / surrogate pairs', () => {
    // 💀 = U+1F480, 4 bytes in UTF-8, 2 UTF-16 code units per char.
    const emoji = '💀'.repeat(10); // 40 bytes, 20 JS-string chars
    // Cap at an *odd* byte count to stress the boundary check — naive
    // truncation would cut mid-codepoint; the helper must round down.
    const res = rotateOnOverflow({ current: emoji, maxBytes: 11 });
    expect(res.fits).toBe(false);
    if (!res.fits) {
      // 11 bytes → max 2 whole emoji (8 bytes) fit.
      expect(res.keep.length).toBe(4); // 2 emoji × 2 UTF-16 units
      expect(res.carry.length).toBe(16);
      // Each side reconstitutes cleanly — iterable codepoint count.
      expect([...res.keep]).toHaveLength(2);
      expect([...res.carry]).toHaveLength(8);
    }
  });
});
