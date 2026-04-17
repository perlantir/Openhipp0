/**
 * Production stealth launcher — wraps `playwright-extra` +
 * `puppeteer-extra-plugin-stealth` so callers who want the
 * baseline-stealth surface (selected in stealth-research.md) can opt
 * in with `createStealthChromium()`. Our `FingerprintDescriptor` +
 * `buildInitScript()` layer on top for finer-grained control.
 *
 * The deps are **optional peers** — the module lazy-imports them so
 * the browser package stays installable without the stealth stack.
 */

import { buildInitScript } from './fingerprint-v2.js';
import type { FingerprintDescriptor } from './types.js';

export interface StealthLaunchOptions {
  readonly headless?: boolean;
  readonly userDataDir?: string;
  readonly viewport?: { width: number; height: number };
  /** Additional init script segments (e.g., our fingerprint v2 overrides). */
  readonly fingerprint?: FingerprintDescriptor;
  /** Optional proxy, formatted as `server: 'http://user:pass@host:port'`. */
  readonly proxy?: { readonly server: string };
  /** Extra plugins (users who want more than baseline stealth). */
  readonly extraPlugins?: readonly unknown[];
}

export interface StealthContext {
  /** Playwright BrowserContext, structurally matched. */
  readonly context: unknown;
  /** The fingerprint init-script source emitted to the context. */
  readonly initScript: string;
}

type ChromiumLike = {
  use(plugin: unknown): unknown;
  launchPersistentContext(
    userDataDir: string,
    options: {
      headless?: boolean;
      viewport?: { width: number; height: number };
      proxy?: { server: string };
    },
  ): Promise<unknown>;
  launch(options: {
    headless?: boolean;
    proxy?: { server: string };
  }): Promise<{ newContext(opts?: { viewport?: { width: number; height: number } }): Promise<unknown> }>;
};

export interface StealthModuleDeps {
  /** Override for tests. Default dynamically imports `playwright-extra`. */
  readonly chromium?: ChromiumLike;
  /** Override for tests. Default dynamically imports `puppeteer-extra-plugin-stealth`. */
  readonly stealth?: unknown;
}

export async function createStealthChromium(
  opts: StealthLaunchOptions = {},
  deps: StealthModuleDeps = {},
): Promise<StealthContext> {
  const chromium = deps.chromium ?? (await loadChromium());
  const stealth = deps.stealth ?? (await loadStealth());
  chromium.use(stealth);
  for (const plugin of opts.extraPlugins ?? []) chromium.use(plugin);

  let context: unknown;
  if (opts.userDataDir) {
    context = await chromium.launchPersistentContext(opts.userDataDir, {
      ...(opts.headless !== undefined ? { headless: opts.headless } : {}),
      ...(opts.viewport ? { viewport: opts.viewport } : {}),
      ...(opts.proxy ? { proxy: opts.proxy } : {}),
    });
  } else {
    const browser = await chromium.launch({
      ...(opts.headless !== undefined ? { headless: opts.headless } : {}),
      ...(opts.proxy ? { proxy: opts.proxy } : {}),
    });
    context = await browser.newContext(opts.viewport ? { viewport: opts.viewport } : undefined);
  }

  const initScript = opts.fingerprint ? buildInitScript(opts.fingerprint) : '';
  if (initScript) {
    // Every Playwright BrowserContext exposes addInitScript.
    const ctx = context as { addInitScript(opts: { content: string }): Promise<void> };
    await ctx.addInitScript({ content: initScript });
  }

  return { context, initScript };
}

async function loadChromium(): Promise<ChromiumLike> {
  try {
    const mod = (await import('playwright-extra')) as unknown as { chromium: ChromiumLike };
    return mod.chromium;
  } catch (err) {
    throw new Error(
      `playwright-extra is not installed. Install as an optional peer dep: \`pnpm add playwright-extra puppeteer-extra-plugin-stealth\`. (${(err as Error).message})`,
    );
  }
}

async function loadStealth(): Promise<unknown> {
  try {
    const mod = (await import('puppeteer-extra-plugin-stealth')) as unknown as { default: () => unknown };
    return mod.default();
  } catch (err) {
    throw new Error(
      `puppeteer-extra-plugin-stealth is not installed. See stealth-launcher.ts for install hint. (${(err as Error).message})`,
    );
  }
}

/**
 * Smoke check — operators run `hipp0 browser stealth doctor` to verify
 * the peer deps are available. Returns metadata for CLI display.
 */
export async function stealthDoctor(): Promise<{
  readonly playwrightExtra: boolean;
  readonly stealthPlugin: boolean;
  readonly messages: readonly string[];
}> {
  const messages: string[] = [];
  let playwrightExtra = false;
  let stealthPlugin = false;
  try {
    await import('playwright-extra');
    playwrightExtra = true;
  } catch {
    messages.push('playwright-extra is not installed');
  }
  try {
    await import('puppeteer-extra-plugin-stealth');
    stealthPlugin = true;
  } catch {
    messages.push('puppeteer-extra-plugin-stealth is not installed');
  }
  if (playwrightExtra && stealthPlugin) {
    messages.push('baseline stealth stack ready');
  }
  return { playwrightExtra, stealthPlugin, messages };
}
