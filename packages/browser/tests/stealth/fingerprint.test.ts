import { describe, expect, it } from 'vitest';

import {
  buildInitScript,
  DEFAULT_CHROME_LINUX,
  DEFAULT_CHROME_MAC,
  DEFAULT_CHROME_WIN,
  estimateEntropy,
  seedOf,
} from '../../src/stealth/fingerprint-v2.js';

describe('fingerprint-v2', () => {
  it('emits an init script that includes the configured descriptor', () => {
    const script = buildInitScript(DEFAULT_CHROME_LINUX);
    expect(script).toContain('navigator');
    expect(script).toContain(DEFAULT_CHROME_LINUX.userAgent);
    expect(script).toContain(DEFAULT_CHROME_LINUX.platform);
    expect(script).toContain('webdriver');
  });

  it('seedOf is deterministic per descriptor', () => {
    const a = seedOf(DEFAULT_CHROME_LINUX);
    const b = seedOf(DEFAULT_CHROME_LINUX);
    expect(a).toBe(b);
    expect(a).not.toBe(seedOf(DEFAULT_CHROME_MAC));
  });

  it('entropy score is high for defaults, lower for stripped config', () => {
    const strong = estimateEntropy(DEFAULT_CHROME_LINUX);
    const weak = estimateEntropy({
      ...DEFAULT_CHROME_LINUX,
      hideWebdriver: false,
      canvas: 'passthrough',
      webgl: 'passthrough',
      audio: 'passthrough',
      blockWebRtcLeaks: false,
    });
    expect(strong.score).toBeGreaterThan(0.9);
    expect(weak.score).toBeLessThan(strong.score);
    expect(weak.notes.length).toBeGreaterThan(0);
  });

  it('mac vs windows descriptors carry platform-appropriate fields', () => {
    expect(DEFAULT_CHROME_MAC.platform).toBe('MacIntel');
    expect(DEFAULT_CHROME_WIN.platform).toBe('Win32');
    expect(DEFAULT_CHROME_MAC.userAgent).toContain('Macintosh');
    expect(DEFAULT_CHROME_WIN.userAgent).toContain('Windows');
  });
});
