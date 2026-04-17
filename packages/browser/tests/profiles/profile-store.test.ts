import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DEFAULT_SCRYPT_P,
  DEFAULT_SCRYPT_R,
  deriveKey,
  encryptBlob,
} from '../../src/profiles/crypto.js';
import { newManifest, ProfileStore } from '../../src/profiles/profile-store.js';
import {
  PROFILE_MANIFEST_VERSION,
  type ProfileId,
  type ProfileLockFile,
  type ProfileManifest,
} from '../../src/profiles/types.js';

/**
 * Tests run with a tiny scrypt factor to keep wall time fast. We override
 * `newManifest` output by writing a manifest with N=1024 directly via
 * `writeManifest`, then exercising `writeBaseArchive` / `restoreBaseArchive`.
 */

function freshRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'hipp0-browser-store-'));
}

function fastManifest(label: string): ProfileManifest {
  const base = newManifest(label);
  // Override scrypt N to something fast (1024) for tests.
  return {
    ...base,
    kdf: { ...base.kdf, N: 1024, r: DEFAULT_SCRYPT_R, p: DEFAULT_SCRYPT_P },
  };
}

describe('ProfileStore', () => {
  let root: string;
  let store: ProfileStore;

  beforeEach(() => {
    root = freshRoot();
    store = new ProfileStore({ root, platform: 'linux' });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('round-trips a manifest', async () => {
    const manifest = fastManifest('round-trip');
    await store.writeManifest(manifest);
    const read = await store.readManifest(manifest.id);
    expect(read).toEqual(manifest);
    expect(read?.version).toBe(PROFILE_MANIFEST_VERSION);
  });

  it('returns null for a missing manifest and empty listIds for a missing root', async () => {
    const emptyStore = new ProfileStore({ root: path.join(root, 'never'), platform: 'linux' });
    expect(await emptyStore.readManifest('nope' as ProfileId)).toBeNull();
    expect(await emptyStore.listIds()).toEqual([]);
  });

  it('writes a base archive and restores it', async () => {
    const manifest = fastManifest('archive-test');
    await store.writeManifest(manifest);

    const src = path.join(root, '_src');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'hello.txt'), 'world');

    await store.writeBaseArchive(manifest.id, src, 'pw');

    const dest = path.join(root, '_dest');
    await store.restoreBaseArchive(manifest.id, dest, 'pw');
    const roundTripped = await fs.readFile(path.join(dest, 'hello.txt'), 'utf8');
    expect(roundTripped).toBe('world');
  });

  it('writes WAL checkpoints and prunes to retention=3', async () => {
    const manifest = fastManifest('wal-test');
    await store.writeManifest(manifest);

    const src = path.join(root, '_src');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'f'), 'x');

    for (let i = 1; i <= 5; i++) {
      await store.writeWalCheckpoint(manifest.id, src, 'pw', i);
    }
    const seqs = await store.listWalSeqs(manifest.id);
    // Retention 3: oldest 2 pruned; latest 3 remain (3,4,5).
    expect(seqs).toEqual([3, 4, 5]);
  });

  it('consolidates the highest WAL into data.enc on clean close', async () => {
    const manifest = fastManifest('close-test');
    await store.writeManifest(manifest);

    const src = path.join(root, '_src');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'h'), 'y');

    await store.writeBaseArchive(manifest.id, src, 'pw');
    await store.writeWalCheckpoint(manifest.id, src, 'pw', 1);
    await store.writeWalCheckpoint(manifest.id, src, 'pw', 2);

    await store.consolidateOnClose(manifest.id);

    const remainingSeqs = await store.listWalSeqs(manifest.id);
    expect(remainingSeqs).toEqual([]);

    // Base archive should still be usable.
    const dest = path.join(root, '_dest');
    await store.restoreBaseArchive(manifest.id, dest, 'pw');
    expect(await fs.readFile(path.join(dest, 'h'), 'utf8')).toBe('y');
  });

  it('classifies lock staleness based on PID liveness and start-time match', async () => {
    const manifest = fastManifest('lock-test');
    await store.writeManifest(manifest);

    // Fake store with a dead PID.
    const deadLock: ProfileLockFile = {
      pid: 999_999_999,
      startedAt: new Date().toISOString(),
      host: 'test-host',
    };
    const sClassifier = new ProfileStore({ root, platform: 'linux', hostOverride: 'test-host' });
    expect(sClassifier.classifyLockStaleness(deadLock)).toBe('likely_stale');

    // Different host → unknown.
    const otherHost: ProfileLockFile = { ...deadLock, host: 'other' };
    expect(sClassifier.classifyLockStaleness(otherHost)).toBe('unknown');
  });

  it('scrubOrphans recovers a crashed profile via WAL', async () => {
    const manifest = fastManifest('scrub-test');
    await store.writeManifest(manifest);

    const src = path.join(root, '_src');
    await fs.mkdir(src, { recursive: true });
    await fs.writeFile(path.join(src, 'state'), 'v1');
    await store.writeBaseArchive(manifest.id, src, 'pw');

    // Simulate: session opened, wrote checkpoint, then crashed.
    await fs.writeFile(path.join(src, 'state'), 'v2');
    await store.writeWalCheckpoint(manifest.id, src, 'pw', 1);
    const activeDir = path.join(store.profileDir(manifest.id), '.active');
    await fs.mkdir(activeDir, { recursive: true });
    await fs.writeFile(path.join(activeDir, 'state'), 'v2');
    await store.writeActivePath(manifest.id, activeDir);

    // Dead-PID lock.
    const deadLock: ProfileLockFile = {
      pid: 999_999_999,
      startedAt: new Date(Date.now() - 30_000).toISOString(),
      host: 'test-host',
    };
    await fs.writeFile(path.join(store.profileDir(manifest.id), 'LOCK'), JSON.stringify(deadLock));

    const scrubStore = new ProfileStore({ root, platform: 'linux', hostOverride: 'test-host' });
    const report = await scrubStore.scrubOrphans();
    expect(report.profilesChecked).toBeGreaterThanOrEqual(1);
    expect(report.orphansFound.length).toBe(1);
    const orphan = report.orphansFound[0]!;
    expect(orphan.recoveredFrom).toBe('wal');
    expect(orphan.walSeq).toBe(1);
    // Active dir shredded.
    const activeExists = await fs.stat(activeDir).catch(() => null);
    expect(activeExists).toBeNull();
    // Recovered artifact present.
    const recoveredEntries = await fs.readdir(path.join(store.profileDir(manifest.id), 'recovered'));
    expect(recoveredEntries.length).toBe(1);
    // Manifest updated with lastUncleanExitAt.
    const after = await scrubStore.readManifest(manifest.id);
    expect(after?.lastUncleanExitAt).toBeTruthy();
  });
});

/** Silence unused-var for deriveKey + encryptBlob (kept as documentation of
 *  how a future delta-WAL test would use them). */
void deriveKey;
void encryptBlob;
