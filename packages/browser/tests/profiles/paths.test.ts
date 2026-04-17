import { describe, expect, it } from 'vitest';

import { defaultProfilesDir, systemChromeUserDataDir, tmpfsCandidate } from '../../src/profiles/paths.js';

describe('paths', () => {
  it('returns an OS-appropriate Chrome user-data-dir for each platform', () => {
    const mac = systemChromeUserDataDir('darwin');
    expect(mac).toContain('Library/Application Support/Google/Chrome');

    const linux = systemChromeUserDataDir('linux', { XDG_CONFIG_HOME: '/custom/cfg' });
    expect(linux).toBe('/custom/cfg/google-chrome');

    const linuxDefault = systemChromeUserDataDir('linux', {});
    expect(linuxDefault).toContain('.config/google-chrome');

    // path.join on POSIX hosts uses '/' — we don't normalize backslashes.
    const win = systemChromeUserDataDir('win32', { LOCALAPPDATA: 'C:\\Users\\X\\AppData\\Local' });
    expect(win).toContain('Google');
    expect(win).toContain('Chrome');
    expect(win).toContain('User Data');
  });

  it('honors HIPP0_HOME for the profiles dir', () => {
    expect(defaultProfilesDir({ HIPP0_HOME: '/tmp/hipp0-test' })).toBe('/tmp/hipp0-test/browser-profiles');
  });

  it('only returns a tmpfs candidate on Linux', () => {
    expect(tmpfsCandidate('darwin')).toBeNull();
    expect(tmpfsCandidate('win32')).toBeNull();
    // Linux case depends on runtime — accept either a string or null.
    const linuxRes = tmpfsCandidate('linux');
    expect(linuxRes === null || typeof linuxRes === 'string').toBe(true);
  });
});
