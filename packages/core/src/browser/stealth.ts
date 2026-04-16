/**
 * Stealth primitives — soften the most obvious automation fingerprints.
 *
 * This is NOT a bypass for anti-bot walls. It applies the standard
 * Playwright hardening recipes (user-agent normalization, navigator.webdriver
 * removal, plugin list injection) so accidental dev-tools-looking traffic
 * doesn't fail benign sites.
 */

import type { BrowserPage } from './types.js';

export const DEFAULT_USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
];

/**
 * Apply the classic anti-detection patches to a freshly-opened page.
 * Must be called BEFORE the first navigation — we patch the execution
 * context so subsequent page loads inherit it.
 */
export async function applyStealth(page: BrowserPage): Promise<void> {
  // navigator.webdriver → undefined instead of the default 'true'.
  await page.evaluate(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator), 'webdriver', { get: () => undefined });
  });

  // Plugin list: Playwright reports empty; real browsers ship at least a PDF viewer.
  await page.evaluate(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator), 'plugins', {
      get: () => [{ name: 'Chrome PDF Viewer' }, { name: 'Native Client' }],
    });
  });

  // Languages — default Playwright is 'en-US' only.
  await page.evaluate(() => {
    Object.defineProperty(Object.getPrototypeOf(navigator), 'languages', {
      get: () => ['en-US', 'en'],
    });
  });
}

/** Pick a plausible UA; deterministic-ish (seeded by index when provided). */
export function pickUserAgent(seed?: number): string {
  const i = typeof seed === 'number' ? seed % DEFAULT_USER_AGENTS.length : Math.floor(Math.random() * DEFAULT_USER_AGENTS.length);
  return DEFAULT_USER_AGENTS[i] ?? DEFAULT_USER_AGENTS[0]!;
}

/** Humanize a numeric delay: base ms ± ~30%. */
export function jitter(baseMs: number): number {
  const spread = 0.3;
  const factor = 1 - spread + Math.random() * spread * 2;
  return Math.max(1, Math.round(baseMs * factor));
}

/** Simulate human-ish typing delay per keystroke. */
export async function humanType(
  page: BrowserPage,
  selector: string,
  text: string,
  baseDelayMs = 70,
): Promise<void> {
  for (const ch of text) {
    await page.type(selector, ch, { delay: jitter(baseDelayMs) });
  }
}
