import { describe, it, expect } from 'vitest';
import { BrowserEngine } from '../../src/browser/engine.js';
import { makeFakeDriver } from './fake-driver.js';

describe('BrowserEngine', () => {
  it('lazy-starts on first newPage() call', async () => {
    const engine = new BrowserEngine({ driver: makeFakeDriver() });
    expect(engine.isRunning()).toBe(false);
    const page = await engine.newPage();
    expect(engine.isRunning()).toBe(true);
    expect(page.url()).toBe('about:blank');
    await engine.stop();
    expect(engine.isRunning()).toBe(false);
  });

  it('start() is idempotent', async () => {
    const engine = new BrowserEngine({ driver: makeFakeDriver() });
    await engine.start();
    await engine.start();
    expect(engine.isRunning()).toBe(true);
    await engine.stop();
  });

  it('stop() is safe to call before start', async () => {
    const engine = new BrowserEngine({ driver: makeFakeDriver() });
    await expect(engine.stop()).resolves.toBeUndefined();
  });

  it('gives a helpful error when Playwright is missing and no driver is injected', async () => {
    const engine = new BrowserEngine();
    // defaultPlaywrightDriver tries to `import('playwright')` which isn't
    // installed in this repo; that's the path we want the error on.
    await expect(engine.start()).rejects.toThrow(/playwright/i);
  });
});
