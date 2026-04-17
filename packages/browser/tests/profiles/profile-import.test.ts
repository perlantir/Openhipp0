import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Hipp0BrowserImportLimitationNotAckedError } from '../../src/errors.js';
import {
  cookieLimitationWarning,
  importFromChrome,
} from '../../src/profiles/profile-import.js';
import { ProfileManager } from '../../src/profiles/profile-manager.js';

const FAST_KDF = { N: 1024 };

function freshRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'hipp0-browser-import-'));
}

describe('profile-import', () => {
  let root: string;
  let sourceDir: string;

  beforeEach(async () => {
    root = freshRoot();
    sourceDir = mkdtempSync(path.join(os.tmpdir(), 'hipp0-browser-import-src-'));
    // Simulate a Chrome user-data-dir with a Default subdir containing state.
    const defaultProf = path.join(sourceDir, 'Default');
    await fs.mkdir(defaultProf, { recursive: true });
    await fs.writeFile(path.join(defaultProf, 'Preferences'), '{"mock":true}');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(sourceDir, { recursive: true, force: true });
  });

  it('throws HIPP0-0506 when the cookie limitation is not acknowledged', async () => {
    const mgr = new ProfileManager({ root, platform: 'linux', kdfOverride: FAST_KDF });
    await expect(
      importFromChrome({
        manager: mgr,
        label: 'imp',
        passphrase: 'pw',
        acceptCookieLimitation: false,
        sourceDir,
      }),
    ).rejects.toBeInstanceOf(Hipp0BrowserImportLimitationNotAckedError);
  });

  it('copies a system Chrome profile into the managed store when acked', async () => {
    const mgr = new ProfileManager({ root, platform: 'linux', kdfOverride: FAST_KDF });

    const imported = await importFromChrome({
      manager: mgr,
      label: 'imported',
      passphrase: 'pw',
      acceptCookieLimitation: true,
      sourceDir,
    });

    expect(imported.label).toBe('imported');
    const listed = await mgr.list();
    expect(listed.find((p) => p.id === imported.id)).toBeTruthy();

    // Restore the archive and confirm the source state is present.
    const dest = path.join(root, `_verify-${imported.id}`);
    await mgr.store.restoreBaseArchive(imported.id, dest, 'pw');
    const prefs = await fs.readFile(path.join(dest, 'Preferences'), 'utf8');
    expect(prefs).toBe('{"mock":true}');
  }, 30_000);

  it('produces a platform-specific warning from cookieLimitationWarning', () => {
    expect(cookieLimitationWarning('darwin')).toContain('macOS Keychain');
    expect(cookieLimitationWarning('win32')).toContain('DPAPI');
    expect(cookieLimitationWarning('linux')).toContain('libsecret');
  });
});
