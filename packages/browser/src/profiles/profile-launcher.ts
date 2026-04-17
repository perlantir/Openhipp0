/**
 * Launch a Chromium instance against a decrypted profile `.active/` dir.
 *
 * Consumes a `BrowserDriver` from `@openhipp0/core/browser`. In production
 * the default Playwright driver is wired by the CLI; in tests a fake
 * driver is injected (see `tests/profiles/profile-launcher.test.ts`).
 */

import type { browser } from '@openhipp0/core';

type BrowserDriver = browser.BrowserDriver;
type BrowserContext = browser.BrowserContext;

export interface LauncherOptions {
  readonly driver: BrowserDriver;
  /** Override headless for tests (default true). */
  readonly headless?: boolean;
  /** Override viewport. */
  readonly viewport?: { width: number; height: number };
}

export interface LaunchedSession {
  /** Playwright-compatible BrowserContext for the running Chromium. */
  readonly context: BrowserContext;
  /** Profile user-data-dir the context is running against. */
  readonly userDataDir: string;
}

export async function launchForProfile(
  userDataDir: string,
  opts: LauncherOptions,
): Promise<LaunchedSession> {
  const context = await opts.driver.launch({
    headless: opts.headless ?? true,
    engine: 'chromium',
    userDataDir,
    ...(opts.viewport ? { viewport: opts.viewport } : {}),
  });
  return { context, userDataDir };
}

export async function closeSession(session: LaunchedSession): Promise<void> {
  await session.context.close();
}
