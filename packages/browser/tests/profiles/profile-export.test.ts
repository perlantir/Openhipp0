import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  envelopeSanity,
  exportProfile,
  importBundle,
} from '../../src/profiles/profile-export.js';
import { ProfileManager } from '../../src/profiles/profile-manager.js';

const FAST_KDF = { N: 1024 };

function freshRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'hipp0-browser-export-'));
}

describe('profile-export', () => {
  let root: string;
  let importRoot: string;
  let outFile: string;

  beforeEach(() => {
    root = freshRoot();
    importRoot = freshRoot();
    outFile = path.join(root, 'exported.hipp0profile');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    rmSync(importRoot, { recursive: true, force: true });
  });

  it('exports a profile to a .hipp0profile envelope and the envelope validates', async () => {
    const mgr = new ProfileManager({ root, platform: 'linux', kdfOverride: FAST_KDF });
    const created = await mgr.create({ label: 'src', passphrase: 'src-pw' });

    // Seed some state through writeBaseArchive directly so the export
    // round-trip has something non-empty.
    const seed = path.join(root, '_seed');
    await fs.mkdir(seed, { recursive: true });
    await fs.writeFile(path.join(seed, 'marker'), 'ship-it');
    await mgr.store.writeBaseArchive(created.id, seed, 'src-pw');

    const result = await exportProfile({
      manager: mgr,
      id: created.id,
      outFile,
      sourcePassphrase: 'src-pw',
      recipientPassphrase: 'recipient-pw',
    });
    expect(result.outFile).toBe(outFile);
    expect(result.generatedPassphrase).toBeUndefined();

    const raw = await fs.readFile(outFile, 'utf8');
    const envelope = JSON.parse(raw);
    expect(envelopeSanity(envelope)).toBe(true);
    expect(envelope.kdf.algo).toBe('scrypt');
    expect(envelope.cipher.algo).toBe('aes-256-gcm');
  }, 30_000);

  it('generates a random recipient passphrase when not provided', async () => {
    const mgr = new ProfileManager({ root, platform: 'linux', kdfOverride: FAST_KDF });
    const created = await mgr.create({ label: 'gen', passphrase: 'src-pw' });

    const result = await exportProfile({
      manager: mgr,
      id: created.id,
      outFile,
      sourcePassphrase: 'src-pw',
    });
    expect(result.generatedPassphrase).toBeTruthy();
    expect(result.generatedPassphrase!.length).toBeGreaterThanOrEqual(16);
  }, 30_000);

  it('round-trips export → importBundle and the imported archive decrypts', async () => {
    // Step 1: export from source manager.
    const srcMgr = new ProfileManager({ root, platform: 'linux', kdfOverride: FAST_KDF });
    const src = await srcMgr.create({ label: 'rt-src', passphrase: 'src-pw' });

    const seed = path.join(root, '_seed');
    await fs.mkdir(seed, { recursive: true });
    await fs.writeFile(path.join(seed, 'state'), 'payload');
    await srcMgr.store.writeBaseArchive(src.id, seed, 'src-pw');

    await exportProfile({
      manager: srcMgr,
      id: src.id,
      outFile,
      sourcePassphrase: 'src-pw',
      recipientPassphrase: 'recip-pw',
    });

    // Step 2: import into a fresh manager at a different root.
    const dstMgr = new ProfileManager({ root: importRoot, platform: 'linux', kdfOverride: FAST_KDF });
    const imported = await importBundle({
      manager: dstMgr,
      inFile: outFile,
      recipientPassphrase: 'recip-pw',
      label: 'rt-imported',
      localPassphrase: 'local-pw',
    });

    // Step 3: decrypt with the local passphrase and verify.
    const verify = path.join(importRoot, '_verify');
    await dstMgr.store.restoreBaseArchive(imported.id, verify, 'local-pw');
    const payload = await fs.readFile(path.join(verify, 'state'), 'utf8');
    expect(payload).toBe('payload');
  }, 60_000);
});
