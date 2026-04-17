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

const DEFAULT_MAX_CONCURRENT_PAGES = 3;

export class BrowserEngine {
  private ctx: BrowserContext | undefined;
  private readonly launchOpts: BrowserLaunchOptions;
  private readonly driverProvider: () => Promise<BrowserDriver>;
  private readonly maxPages: number;
  private pageCount = 0;

  constructor(config: BrowserEngineConfig & { maxConcurrentPages?: number } = {}) {
    this.launchOpts = config.launch ?? { headless: true };
    this.driverProvider = config.driver
      ? async () => config.driver!
      : defaultPlaywrightDriver;
    this.maxPages = config.maxConcurrentPages ?? DEFAULT_MAX_CONCURRENT_PAGES;
  }

  async start(): Promise<void> {
    if (this.ctx) return;
    const driver = await this.driverProvider();
    this.ctx = await driver.launch(this.launchOpts);
  }

  async newPage(): Promise<BrowserPage> {
    if (!this.ctx) await this.start();
    if (this.pageCount >= this.maxPages) {
      throw new Error(
        `BrowserEngine: page cap reached (${this.pageCount}/${this.maxPages}); close a page or bump maxConcurrentPages.`,
      );
    }
    this.pageCount++;
    try {
      const page = await this.ctx!.newPage();
      // Decrement when caller closes — best effort; if the page has a close()
      // hook, wrap it.
      const originalClose = (page as unknown as { close?: () => Promise<void> }).close;
      if (typeof originalClose === 'function') {
        (page as unknown as { close: () => Promise<void> }).close = async () => {
          try {
            await originalClose.call(page);
          } finally {
            this.pageCount = Math.max(0, this.pageCount - 1);
          }
        };
      }
      return page;
    } catch (err) {
      this.pageCount = Math.max(0, this.pageCount - 1);
      throw err;
    }
  }

  async stop(): Promise<void> {
    if (!this.ctx) return;
    try {
      await this.ctx.close();
    } catch {
      /* best effort */
    }
    this.ctx = undefined;
    this.pageCount = 0;
  }

  isRunning(): boolean {
    return !!this.ctx;
  }

  openPageCount(): number {
    return this.pageCount;
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
