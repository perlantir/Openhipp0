import { describe, expect, it, vi } from 'vitest';

import { createStealthChromium, stealthDoctor } from '../../src/stealth/stealth-launcher.js';
import { DEFAULT_CHROME_LINUX } from '../../src/stealth/fingerprint-v2.js';

describe('createStealthChromium', () => {
  it('wires the stealth plugin + injects the fingerprint init script', async () => {
    const use = vi.fn();
    const addInitScript = vi.fn().mockResolvedValue(undefined);
    const newContext = vi.fn().mockResolvedValue({ addInitScript });
    const launch = vi.fn().mockResolvedValue({ newContext });
    const chromium = {
      use,
      async launchPersistentContext() {
        return { addInitScript };
      },
      launch,
    };
    const fakePlugin = { name: 'fake-stealth' };

    const res = await createStealthChromium(
      { fingerprint: DEFAULT_CHROME_LINUX },
      { chromium: chromium as unknown as never, stealth: fakePlugin },
    );

    expect(use).toHaveBeenCalledWith(fakePlugin);
    expect(launch).toHaveBeenCalledOnce();
    expect(addInitScript).toHaveBeenCalledOnce();
    expect(res.initScript).toContain('navigator');
  });

  it('uses launchPersistentContext when userDataDir is set', async () => {
    const use = vi.fn();
    const launchPersistentContext = vi.fn().mockResolvedValue({
      async addInitScript() {},
    });
    const chromium = {
      use,
      launchPersistentContext,
      async launch() {
        return { async newContext() { return {}; } };
      },
    };
    await createStealthChromium(
      { userDataDir: '/tmp/profile' },
      { chromium: chromium as unknown as never, stealth: {} },
    );
    expect(launchPersistentContext).toHaveBeenCalledOnce();
    expect(launchPersistentContext.mock.calls[0]![0]).toBe('/tmp/profile');
  });

  it('passes proxy + viewport options through', async () => {
    const launch = vi.fn().mockResolvedValue({
      async newContext(opts: unknown) {
        return {
          async addInitScript() {},
          _receivedOpts: opts,
        };
      },
    });
    const chromium = {
      use() {},
      launchPersistentContext: vi.fn(),
      launch,
    };
    await createStealthChromium(
      { proxy: { server: 'http://user:pw@host:8080' }, viewport: { width: 1600, height: 900 } },
      { chromium: chromium as unknown as never, stealth: {} },
    );
    expect(launch.mock.calls[0]![0].proxy).toEqual({ server: 'http://user:pw@host:8080' });
  });
});

describe('stealthDoctor', () => {
  it('returns readiness metadata', async () => {
    const result = await stealthDoctor();
    expect(typeof result.playwrightExtra).toBe('boolean');
    expect(typeof result.stealthPlugin).toBe('boolean');
    expect(result.messages.length).toBeGreaterThan(0);
  });
});
