import { describe, expect, it, vi } from 'vitest';
import { BrowserEngine } from '../../src/browser/engine.js';
import { createBrowserTools } from '../../src/browser/tools.js';
import type {
  BrowserContext,
  BrowserDriver,
  BrowserPage,
} from '../../src/browser/types.js';
import type { ExecutionContext } from '../../src/tools/types.js';

const execCtx: ExecutionContext = {
  sandbox: 'native',
  timeoutMs: 1000,
  allowedPaths: [],
  allowedDomains: [],
  grantedPermissions: ['browser.use', 'net.fetch'],
  agent: { id: 'a', name: 'a', role: 'assistant' },
  projectId: 'p1',
};

function fakePage(): BrowserPage {
  const p = {
    goto: vi.fn(async () => undefined),
    url: () => 'about:blank',
    title: () => 'Fake',
    content: () => '<html><body></body></html>',
    screenshot: async () => Buffer.alloc(1),
    close: async () => undefined,
    locator: () => ({
      click: async () => undefined,
      fill: async () => undefined,
      textContent: async () => '',
    }),
    waitForLoadState: async () => undefined,
    waitForURL: async () => undefined,
    waitForSelector: async () => ({ textContent: async () => '' }),
    setDefaultTimeout: () => undefined,
    evaluate: async () => undefined,
    $: async () => null,
    context: () => ({ cookies: async () => [] }),
    route: async () => undefined,
  };
  return p as unknown as BrowserPage;
}

function fakeDriver(): BrowserDriver {
  return {
    async launch(): Promise<BrowserContext> {
      let pages = 0;
      return {
        async newPage() {
          pages++;
          return fakePage();
        },
        async close() {
          void pages;
        },
        async cookies() {
          return [];
        },
        async addCookies() {
          /* no-op */
        },
      };
    },
  };
}

function fakeResolver(map: Record<string, string[]>) {
  return {
    async resolve(host: string) {
      return map[host] ?? [];
    },
  };
}

describe('browser_navigate + SSRF', () => {
  it('allows a public URL after SSRF passes', async () => {
    const engine = new BrowserEngine({ driver: fakeDriver() });
    const [navigate] = createBrowserTools(engine, {
      resolver: fakeResolver({ 'api.example.com': ['8.8.8.8'] }),
    });
    const r = await navigate!.execute({ url: 'https://api.example.com/' }, execCtx);
    expect(r.ok).toBe(true);
    expect(String(r.output)).toContain('pinned=8.8.8.8');
    await engine.stop();
  });

  it('blocks a literal private IP', async () => {
    const engine = new BrowserEngine({ driver: fakeDriver() });
    const [navigate] = createBrowserTools(engine, {
      resolver: fakeResolver({}),
    });
    const r = await navigate!.execute({ url: 'http://127.0.0.1/admin' }, execCtx);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('HIPP0_BROWSER_PRIVATE_ADDRESS_BLOCKED');
    await engine.stop();
  });

  it('blocks when ANY resolved IP is private (DNS rebind defense)', async () => {
    const engine = new BrowserEngine({ driver: fakeDriver() });
    const [navigate] = createBrowserTools(engine, {
      resolver: fakeResolver({ 'sneaky.example': ['8.8.8.8', '10.0.0.1'] }),
    });
    const r = await navigate!.execute({ url: 'https://sneaky.example/' }, execCtx);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('HIPP0_BROWSER_PRIVATE_ADDRESS_BLOCKED');
    await engine.stop();
  });

  it('respects isUrlAllowed policy callback', async () => {
    const engine = new BrowserEngine({ driver: fakeDriver() });
    const [navigate] = createBrowserTools(engine, {
      resolver: fakeResolver({ 'api.example.com': ['8.8.8.8'] }),
      isUrlAllowed: (u) => !u.includes('api.example.com'),
    });
    const r = await navigate!.execute({ url: 'https://api.example.com/' }, execCtx);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('HIPP0_BROWSER_URL_BLOCKED_BY_POLICY');
    await engine.stop();
  });

  it('rejects non-http(s) schemes at validation', async () => {
    const engine = new BrowserEngine({ driver: fakeDriver() });
    const [navigate] = createBrowserTools(engine, {
      resolver: fakeResolver({}),
    });
    // Zod's .url() accepts any URL scheme, so we rely on the SSRF guard
    // inside execute() to block file://. The guard must return an error.
    const r = await navigate!.execute({ url: 'file:///etc/passwd' }, execCtx);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('HIPP0_BROWSER_SCHEME_BLOCKED');
    await engine.stop();
  });
});

describe('BrowserEngine page cap', () => {
  it('rejects newPage beyond maxConcurrentPages', async () => {
    const engine = new BrowserEngine({ driver: fakeDriver(), maxConcurrentPages: 2 });
    await engine.start();
    await engine.newPage();
    await engine.newPage();
    await expect(engine.newPage()).rejects.toThrow(/page cap reached/);
    await engine.stop();
  });

  it('decrements count when a page is closed', async () => {
    const engine = new BrowserEngine({ driver: fakeDriver(), maxConcurrentPages: 2 });
    await engine.start();
    const p1 = await engine.newPage();
    await engine.newPage();
    expect(engine.openPageCount()).toBe(2);
    await p1.close();
    expect(engine.openPageCount()).toBe(1);
    // One slot free again.
    await engine.newPage();
    await engine.stop();
  });
});
