import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProfileManager, type ProfileId, type ProfileManager } from '@openhipp0/browser';

import {
  runBrowserProfileCreate,
  runBrowserProfileDelete,
  runBrowserProfileExport,
  runBrowserProfileImportBundle,
  runBrowserProfileImportChrome,
  runBrowserProfileList,
  runBrowserProfileStatus,
} from '../../src/commands/browser-profile.js';

const FAST_KDF = { N: 1024 };

function freshRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'hipp0-cli-browser-'));
}

function mgrFor(root: string): ProfileManager {
  return createProfileManager({ root, platform: 'linux', kdfOverride: FAST_KDF });
}

describe('browser-profile CLI commands', () => {
  let root: string;
  let manager: ProfileManager;

  beforeEach(() => {
    root = freshRoot();
    manager = mgrFor(root);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('create then list reports the new profile', async () => {
    const created = await runBrowserProfileCreate({
      manager,
      passphrase: 'pw',
      label: 'cli-first',
      tags: ['ops'],
    });
    expect(created.exitCode).toBe(0);
    const listed = await runBrowserProfileList({ manager });
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout?.some((line) => line.includes('cli-first'))).toBe(true);
  });

  it('status returns closed → open after a direct manager open()', async () => {
    const created = await runBrowserProfileCreate({
      manager,
      passphrase: 'pw',
      label: 'cli-status',
    });
    const id = (created.data as { profile: { id: ProfileId } }).profile.id;
    const before = await runBrowserProfileStatus({ manager, id });
    expect(before.exitCode).toBe(0);
    expect(before.stdout?.some((l) => l.includes('closed'))).toBe(true);
  });

  it('status reports not_found for an unknown id', async () => {
    const result = await runBrowserProfileStatus({ manager, id: 'nope' as ProfileId });
    expect(result.exitCode).toBe(0);
    expect(result.stdout?.some((l) => l.includes('not found'))).toBe(true);
  });

  it('delete removes a profile', async () => {
    const created = await runBrowserProfileCreate({ manager, passphrase: 'pw', label: 'cli-del' });
    const id = (created.data as { profile: { id: ProfileId } }).profile.id;
    const result = await runBrowserProfileDelete({ manager, id });
    expect(result.exitCode).toBe(0);
    const listed = await runBrowserProfileList({ manager });
    expect(listed.stdout?.[0]).toBe('no profiles');
  });

  it('import-chrome without --accept-cookie-limitation prints a warning and exits 2', async () => {
    const sourceRoot = mkdtempSync(path.join(os.tmpdir(), 'hipp0-cli-import-src-'));
    try {
      await fs.mkdir(path.join(sourceRoot, 'Default'), { recursive: true });
      await fs.writeFile(path.join(sourceRoot, 'Default', 'Preferences'), '{}');
      const result = await runBrowserProfileImportChrome({
        manager,
        passphrase: 'pw',
        label: 'blocked',
        sourceDir: sourceRoot,
        platform: 'linux',
        acceptCookieLimitation: false,
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr?.join('\n')).toContain('libsecret');
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  });

  it('import-chrome with --accept-cookie-limitation creates the managed profile', async () => {
    const sourceRoot = mkdtempSync(path.join(os.tmpdir(), 'hipp0-cli-import-src2-'));
    try {
      await fs.mkdir(path.join(sourceRoot, 'Default'), { recursive: true });
      await fs.writeFile(path.join(sourceRoot, 'Default', 'Preferences'), '{}');
      const result = await runBrowserProfileImportChrome({
        manager,
        passphrase: 'pw',
        label: 'accepted',
        sourceDir: sourceRoot,
        platform: 'linux',
        acceptCookieLimitation: true,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout?.some((l) => l.includes('imported profile'))).toBe(true);
    } finally {
      rmSync(sourceRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('export → import-bundle round-trips a profile', async () => {
    const created = await runBrowserProfileCreate({ manager, passphrase: 'pw', label: 'cli-rt' });
    const id = (created.data as { profile: { id: ProfileId } }).profile.id;

    // Seed state so the round trip has something to verify.
    const seed = path.join(root, '_seed');
    await fs.mkdir(seed, { recursive: true });
    await fs.writeFile(path.join(seed, 'payload'), 'hi');
    await manager.store.writeBaseArchive(id, seed, 'pw');

    const outFile = path.join(root, 'bundle.hipp0profile');
    const exportRes = await runBrowserProfileExport({
      manager,
      passphrase: 'pw',
      id,
      outFile,
      recipientPassphrase: 'recipient-pw',
    });
    expect(exportRes.exitCode).toBe(0);

    // Import into a fresh manager at a different root.
    const otherRoot = mkdtempSync(path.join(os.tmpdir(), 'hipp0-cli-browser-dst-'));
    try {
      const dstMgr = mgrFor(otherRoot);
      const importRes = await runBrowserProfileImportBundle({
        manager: dstMgr,
        passphrase: 'local-pw',
        inFile: outFile,
        recipientPassphrase: 'recipient-pw',
        label: 'cli-rt-imported',
      });
      expect(importRes.exitCode).toBe(0);
      const listed = await runBrowserProfileList({ manager: dstMgr });
      expect(listed.stdout?.some((l) => l.includes('cli-rt-imported'))).toBe(true);
    } finally {
      rmSync(otherRoot, { recursive: true, force: true });
    }
  }, 60_000);
});
