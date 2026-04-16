import { describe, it, expect } from 'vitest';
import { BrowserEngine } from '../../src/browser/engine.js';
import { createBrowserTools } from '../../src/browser/tools.js';
import type { ExecutionContext } from '../../src/tools/types.js';
import { makeFakeDriver } from './fake-driver.js';

function ctx(): ExecutionContext {
  return {
    sandbox: 'native',
    timeoutMs: 5_000,
    allowedPaths: [],
    allowedDomains: [],
    grantedPermissions: ['browser.use', 'net.fetch'],
    agent: { id: 'a', name: 'A', role: 'r' },
    projectId: 'p',
  };
}

describe('createBrowserTools', () => {
  it('returns 6 tools wired to a shared page', async () => {
    const engine = new BrowserEngine({ driver: makeFakeDriver({ initialTitle: 'Demo' }) });
    const tools = createBrowserTools(engine);
    expect(tools.map((t) => t.name)).toEqual([
      'browser_navigate',
      'browser_click',
      'browser_type',
      'browser_screenshot',
      'browser_extract',
      'browser_state',
    ]);

    const navigate = tools[0]!;
    const r = await navigate.execute({ url: 'https://example.com' }, ctx());
    expect(r.ok).toBe(true);
    expect(r.output).toMatch(/navigated to https:\/\/example\.com/);

    await engine.stop();
  });

  it('browser_state returns a JSON PageState', async () => {
    const engine = new BrowserEngine({ driver: makeFakeDriver({ initialTitle: 'Demo' }) });
    const tools = createBrowserTools(engine);
    const stateTool = tools.find((t) => t.name === 'browser_state')!;
    const r = await stateTool.execute({}, ctx());
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(r.output as string) as { title: string };
    expect(parsed.title).toBe('Demo');
    await engine.stop();
  });

  it('browser_screenshot returns base64 encoded PNG', async () => {
    const engine = new BrowserEngine({ driver: makeFakeDriver() });
    const tools = createBrowserTools(engine);
    const shot = tools.find((t) => t.name === 'browser_screenshot')!;
    const r = await shot.execute({}, ctx());
    expect(r.ok).toBe(true);
    expect(r.metadata?.['encoding']).toBe('base64-png');
    await engine.stop();
  });
});
