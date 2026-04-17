import { mkdtempSync, rmSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Hipp0BrowserProfileBusyError, Hipp0BrowserProfileNotFoundError } from '../../src/errors.js';
import { ProfileManager } from '../../src/profiles/profile-manager.js';
import type { ProfileId } from '../../src/profiles/types.js';
import { createFakeDriver } from './fake-driver.js';

const FAST_KDF = { N: 1024 };

function freshRoot(): string {
  return mkdtempSync(path.join(os.tmpdir(), 'hipp0-browser-mgr-'));
}

describe('ProfileManager', () => {
  let root: string;

  beforeEach(() => {
    root = freshRoot();
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates, lists, then deletes a profile', async () => {
    const mgr = new ProfileManager({ root, platform: 'linux', kdfOverride: FAST_KDF });
    const created = await mgr.create({ label: 'first', passphrase: 'pw' });

    const listed = await mgr.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]!.label).toBe('first');
    expect(listed[0]!.id).toBe(created.id);

    await mgr.delete(created.id);
    expect(await mgr.list()).toHaveLength(0);
  });

  it('delete throws if the profile does not exist', async () => {
    const mgr = new ProfileManager({ root, platform: 'linux', kdfOverride: FAST_KDF });
    await expect(mgr.delete('missing' as ProfileId)).rejects.toBeInstanceOf(
      Hipp0BrowserProfileNotFoundError,
    );
  });

  it('status returns {state: not_found} for unknown ids', async () => {
    const mgr = new ProfileManager({ root, platform: 'linux', kdfOverride: FAST_KDF });
    const s = await mgr.status('no-such' as ProfileId);
    expect(s).toEqual({ state: 'not_found', id: 'no-such' });
  });

  it('status returns closed for a fresh profile, open after open() is called', async () => {
    const driver = createFakeDriver();
    const mgr = new ProfileManager({
      root,
      platform: 'linux',
      driver,
      autoCheckpoint: false,
      kdfOverride: FAST_KDF,
    });
    const created = await mgr.create({ label: 's', passphrase: 'pw' });

    expect(await mgr.status(created.id)).toEqual({ state: 'closed', id: created.id });

    await mgr.open(created.id, 'pw');
    const s = await mgr.status(created.id);
    expect(s.state).toBe('open');
    if (s.state === 'open') {
      expect(s.diagnostic.lockStaleness).toBe('live');
      expect(s.diagnostic.resolutionOptions).toEqual(['wait', 'kill', 'status']);
    }

    await mgr.close(created.id);
    expect(await mgr.status(created.id)).toEqual({ state: 'closed', id: created.id });
  });

  it('rejects a second open() against the same profile', async () => {
    const driver = createFakeDriver();
    const mgr = new ProfileManager({
      root,
      platform: 'linux',
      driver,
      autoCheckpoint: false,
      kdfOverride: FAST_KDF,
    });
    const created = await mgr.create({ label: 'x', passphrase: 'pw' });
    await mgr.open(created.id, 'pw');
    await expect(mgr.open(created.id, 'pw')).rejects.toBeInstanceOf(Hipp0BrowserProfileBusyError);
    await mgr.close(created.id);
  });

  it('round-trips session state through open → checkpoint → close → open', async () => {
    const driver = createFakeDriver();
    const mgr = new ProfileManager({
      root,
      platform: 'linux',
      driver,
      autoCheckpoint: false,
      kdfOverride: FAST_KDF,
    });
    const created = await mgr.create({ label: 'rt', passphrase: 'pw' });

    const handle = await mgr.open(created.id, 'pw');
    await fs.writeFile(path.join(handle.activeDir, 'marker.txt'), 'payload-v1');
    await mgr.checkpoint(created.id);
    await fs.writeFile(path.join(handle.activeDir, 'marker.txt'), 'payload-v2');
    await mgr.close(created.id);

    const reopened = await mgr.open(created.id, 'pw');
    const reloaded = await fs.readFile(path.join(reopened.activeDir, 'marker.txt'), 'utf8');
    expect(reloaded).toBe('payload-v2'); // clean-close consolidated the final state
    await mgr.close(created.id);
  });

  it('records lastOpenedAt + lastCleanCloseAt on the manifest', async () => {
    const driver = createFakeDriver();
    const mgr = new ProfileManager({
      root,
      platform: 'linux',
      driver,
      autoCheckpoint: false,
      kdfOverride: FAST_KDF,
    });
    const created = await mgr.create({ label: 't', passphrase: 'pw' });

    await mgr.open(created.id, 'pw');
    await mgr.close(created.id);

    const m = await mgr.store.readManifest(created.id);
    expect(m?.lastOpenedAt).toBeTruthy();
    expect(m?.lastCleanCloseAt).toBeTruthy();
    expect(m?.lastUncleanExitAt).toBeUndefined();
  });

  it('scrubOrphans reports no orphans for a clean store', async () => {
    const mgr = new ProfileManager({ root, platform: 'linux', kdfOverride: FAST_KDF });
    const report = await mgr.scrubOrphans();
    expect(report.profilesChecked).toBe(0);
    expect(report.orphansFound).toEqual([]);
  });
});
