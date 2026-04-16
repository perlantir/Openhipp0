/**
 * BrowserEngine — thin ownership wrapper around a BrowserDriver + BrowserContext
 * + BrowserPage. Lazy-loads Playwright on first use so installations that
 * don't need browser automation pay zero startup cost.
 *
 * Tests inject a fake driver via `new BrowserEngine({ driver: fake })`.
 */

import type {
  BrowserContext,
  BrowserDriver,
  BrowserEngineConfig,
  BrowserLaunchOptions,
  BrowserPage,
} from './types.js';

export class BrowserEngine {
  private ctx: BrowserContext | undefined;
  private readonly launchOpts: BrowserLaunchOptions;
  private readonly driverProvider: () => Promise<BrowserDriver>;

  constructor(config: BrowserEngineConfig = {}) {
    this.launchOpts = config.launch ?? { headless: true };
    this.driverProvider = config.driver
      ? async () => config.driver!
      : defaultPlaywrightDriver;
  }

  async start(): Promise<void> {
    if (this.ctx) return;
    const driver = await this.driverProvider();
    this.ctx = await driver.launch(this.launchOpts);
  }

  async newPage(): Promise<BrowserPage> {
    if (!this.ctx) await this.start();
    return this.ctx!.newPage();
  }

  async stop(): Promise<void> {
    if (!this.ctx) return;
    try {
      await this.ctx.close();
    } catch {
      /* best effort */
    }
    this.ctx = undefined;
  }

  isRunning(): boolean {
    return !!this.ctx;
  }
}

/**
 * Lazy Playwright import. Throws a clear error if @playwright/test isn't
 * installed — callers should either inject a driver or install the peer dep.
 */
async function defaultPlaywrightDriver(): Promise<BrowserDriver> {
  try {
    // `playwright` is an optional peer dep. Using a variable specifier keeps
    // TypeScript's resolver from requiring @types/playwright at build time.
    const specifier = 'playwright';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pkg = (await import(/* @vite-ignore */ specifier)) as any;
    const { chromium } = pkg;
    return {
      async launch(opts) {
        const browser = await chromium.launch({
          headless: opts?.headless ?? true,
          timeout: opts?.timeout,
        });
        const ctx = await browser.newContext({
          viewport: opts?.viewport ?? { width: 1280, height: 720 },
        });
        return {
          async newPage() {
            return (await ctx.newPage()) as unknown as BrowserPage;
          },
          async close() {
            await ctx.close();
            await browser.close();
          },
          async cookies() {
            return ctx.cookies();
          },
          async addCookies(cookies) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            await ctx.addCookies(cookies as any);
          },
        };
      },
    };
  } catch (err) {
    throw new Error(
      'Browser automation requires `playwright` as a peer dependency. ' +
        'Run `pnpm add playwright` (and `npx playwright install chromium`) ' +
        'or inject a BrowserDriver into the engine for tests. ' +
        `Original error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
