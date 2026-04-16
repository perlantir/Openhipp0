/**
 * FakeDriver — a lightweight BrowserDriver for tests. Models just enough of
 * Playwright's surface to drive the engine / executor / tools without the
 * real browser process.
 */

import type {
  AxNode,
  BrowserContext,
  BrowserDriver,
  BrowserPage,
} from '../../src/browser/types.js';

export interface FakePageOptions {
  initialUrl?: string;
  initialTitle?: string;
  axTree?: AxNode;
  innerText?: string;
}

export function makeFakePage(opts: FakePageOptions = {}): BrowserPage {
  let url = opts.initialUrl ?? 'about:blank';
  let title = opts.initialTitle ?? '';
  const axTree: AxNode =
    opts.axTree ?? {
      role: 'WebArea',
      name: title,
      children: [
        { role: 'button', name: 'Sign In', children: [] },
        { role: 'textbox', name: 'Search', value: '', children: [] },
      ],
    };
  const clicks: string[] = [];
  const typedInto: Record<string, string> = {};
  const filled: Record<string, string> = {};

  const page: BrowserPage = {
    url: () => url,
    async title() {
      return title;
    },
    async goto(u) {
      url = u;
      title = `Page at ${u}`;
    },
    async click(selector) {
      clicks.push(selector);
    },
    async fill(selector, value) {
      filled[selector] = value;
    },
    async type(selector, text) {
      typedInto[selector] = (typedInto[selector] ?? '') + text;
    },
    async selectOption(_selector, _value) {
      /* no-op */
    },
    async content() {
      return `<html><head><title>${title}</title></head><body>${opts.innerText ?? ''}</body></html>`;
    },
    async innerText(_selector) {
      return opts.innerText ?? '';
    },
    async screenshot() {
      return Buffer.from('fake-png');
    },
    async evaluate<T>(fn: (...args: unknown[]) => T, ...args: unknown[]): Promise<T> {
      return fn(...args);
    },
    mouse: {
      async wheel() {
        /* no-op */
      },
    },
    async waitForTimeout() {
      /* no-op */
    },
    accessibility: {
      async snapshot() {
        return axTree;
      },
    },
    async close() {
      /* no-op */
    },
  };

  // Attach inspection helpers without polluting the public interface.
  (page as BrowserPage & { _clicks: string[]; _typedInto: Record<string, string>; _filled: Record<string, string> })._clicks = clicks;
  (page as BrowserPage & { _clicks: string[]; _typedInto: Record<string, string>; _filled: Record<string, string> })._typedInto = typedInto;
  (page as BrowserPage & { _clicks: string[]; _typedInto: Record<string, string>; _filled: Record<string, string> })._filled = filled;

  return page;
}

export function makeFakeDriver(pageOpts: FakePageOptions = {}): BrowserDriver {
  return {
    async launch() {
      const ctx: BrowserContext = {
        async newPage() {
          return makeFakePage(pageOpts);
        },
        async close() {
          /* no-op */
        },
        async cookies() {
          return [];
        },
        async addCookies() {
          /* no-op */
        },
      };
      return ctx;
    },
  };
}
