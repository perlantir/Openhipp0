/**
 * Minimal `BrowserDriver` fake — mirrors the `core/browser` structural
 * interface without touching Playwright. Only implements what the profile
 * launcher calls (`driver.launch(opts) → context.close()`).
 */

import type { browser as coreBrowser } from '@openhipp0/core';

export interface FakeDriverOptions {
  readonly onLaunch?: (opts: coreBrowser.BrowserLaunchOptions | undefined) => void;
  readonly onClose?: () => void;
}

export function createFakeDriver(opts: FakeDriverOptions = {}): coreBrowser.BrowserDriver {
  return {
    async launch(launchOpts?: coreBrowser.BrowserLaunchOptions): Promise<coreBrowser.BrowserContext> {
      opts.onLaunch?.(launchOpts);
      return createFakeContext(opts.onClose);
    },
  };
}

function createFakeContext(onClose?: () => void): coreBrowser.BrowserContext {
  let closed = false;
  return {
    async newPage(): Promise<coreBrowser.BrowserPage> {
      throw new Error('fake context: newPage not implemented');
    },
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      onClose?.();
    },
    async cookies(): Promise<Record<string, unknown>[]> {
      return [];
    },
    async addCookies(_cookies: Record<string, unknown>[]): Promise<void> {
      /* noop */
    },
  };
}
