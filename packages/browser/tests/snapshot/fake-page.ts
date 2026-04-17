/**
 * In-memory fake BrowserPage + BrowserContext for snapshot tests. Mirrors
 * the structural surface from @openhipp0/core/browser without Playwright.
 */

import type { browser } from '@openhipp0/core';

export interface FakePageState {
  url: string;
  title: string;
  html: string;
  png: Buffer;
  ax: browser.AxNode | null;
}

export function createFakePage(initial: FakePageState): {
  page: browser.BrowserPage;
  mutate: (patch: Partial<FakePageState>) => void;
  calls: string[];
} {
  const state = { ...initial };
  const calls: string[] = [];
  const page: browser.BrowserPage = {
    url: () => state.url,
    async title() {
      return state.title;
    },
    async goto(url: string) {
      calls.push(`goto:${url}`);
      state.url = url;
    },
    async click(_sel: string) {
      /* noop */
    },
    async fill(_sel: string, _v: string) {
      /* noop */
    },
    async type(_sel: string, _t: string) {
      /* noop */
    },
    async selectOption(_sel: string, _v: string) {
      /* noop */
    },
    async content() {
      return state.html;
    },
    async innerText(_sel: string) {
      return '';
    },
    async screenshot() {
      return state.png;
    },
    async evaluate() {
      return undefined as never;
    },
    mouse: {
      async wheel(_x: number, _y: number) {
        /* noop */
      },
    },
    async waitForTimeout(_ms: number) {
      /* noop */
    },
    accessibility: {
      async snapshot() {
        return state.ax;
      },
    },
    async close() {
      /* noop */
    },
  };
  return {
    page,
    mutate: (patch) => Object.assign(state, patch),
    calls,
  };
}

export function createFakeContext(cookies: Record<string, unknown>[] = []): {
  context: browser.BrowserContext;
  addedCookies: Record<string, unknown>[];
} {
  const added: Record<string, unknown>[] = [];
  const context: browser.BrowserContext = {
    async newPage() {
      throw new Error('fake context: newPage not implemented');
    },
    async close() {
      /* noop */
    },
    async cookies() {
      return [...cookies];
    },
    async addCookies(toAdd: Record<string, unknown>[]) {
      added.push(...toAdd);
    },
  };
  return { context, addedCookies: added };
}
