import { describe, expect, it, vi } from 'vitest';

import { closeSession, launchForProfile } from '../../src/profiles/profile-launcher.js';
import { createFakeDriver } from './fake-driver.js';

describe('profile-launcher', () => {
  it('launches Chromium against the supplied user-data-dir', async () => {
    const onLaunch = vi.fn();
    const driver = createFakeDriver({ onLaunch });
    const session = await launchForProfile('/tmp/active-x', { driver });
    expect(onLaunch).toHaveBeenCalledOnce();
    const launchArgs = onLaunch.mock.calls[0]![0];
    expect(launchArgs.userDataDir).toBe('/tmp/active-x');
    expect(launchArgs.engine).toBe('chromium');
    expect(launchArgs.headless).toBe(true);
    expect(session.userDataDir).toBe('/tmp/active-x');
  });

  it('passes viewport override through to the driver', async () => {
    const onLaunch = vi.fn();
    const driver = createFakeDriver({ onLaunch });
    await launchForProfile('/tmp/active-y', { driver, viewport: { width: 1280, height: 720 } });
    expect(onLaunch.mock.calls[0]![0].viewport).toEqual({ width: 1280, height: 720 });
  });

  it('closes the underlying context on closeSession', async () => {
    const onClose = vi.fn();
    const driver = createFakeDriver({ onClose });
    const session = await launchForProfile('/tmp/active-z', { driver });
    await closeSession(session);
    expect(onClose).toHaveBeenCalledOnce();
  });
});
