/**
 * ProfileManager — the public orchestrator. Wraps ProfileStore with
 * higher-level operations (create / list / open / close / delete / status)
 * and maintains the one-Chromium-per-profile invariant in memory.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { browser as coreBrowser } from '@openhipp0/core';

import {
  Hipp0BrowserProfileBusyError,
  Hipp0BrowserProfileNotFoundError,
} from '../errors.js';
import { newManifest, ProfileStore, type ProfileStoreOptions } from './profile-store.js';
import { closeSession, launchForProfile, type LaunchedSession } from './profile-launcher.js';
import type {
  Profile,
  ProfileBusyDiagnostic,
  ProfileId,
  ProfileManifest,
  ProfileStatus,
  ScryptKdfParams,
  ScrubReport,
} from './types.js';

export type PassphraseProvider = string | (() => Promise<string>);

export interface CreateOptions {
  readonly label: string;
  readonly tags?: readonly string[];
  readonly notes?: string;
  readonly passphrase: PassphraseProvider;
}

export interface OpenedProfileHandle {
  readonly profile: Profile;
  readonly session: LaunchedSession;
  /** Internal: the active dir on disk (may live on tmpfs on Linux). */
  readonly activeDir: string;
  readonly checkpointTimer: NodeJS.Timeout | null;
}

export interface ProfileManagerOptions extends ProfileStoreOptions {
  /** Browser driver for launching Chromium. Required when calling `open()`. */
  readonly driver?: coreBrowser.BrowserDriver;
  /** Checkpoint interval (ms). Defaults to 60_000. */
  readonly checkpointIntervalMs?: number;
  /** Set to false to disable auto-checkpoint (tests). */
  readonly autoCheckpoint?: boolean;
  /**
   * Override scrypt params at `create()` time. Tests pass a fast profile
   * (e.g. N=1024); production never sets this so `defaultKdfParams()` wins.
   */
  readonly kdfOverride?: Partial<Omit<ScryptKdfParams, 'algo' | 'saltB64'>>;
}

export class ProfileManager {
  readonly #store: ProfileStore;
  readonly #driver: coreBrowser.BrowserDriver | undefined;
  readonly #checkpointMs: number;
  readonly #autoCheckpoint: boolean;
  readonly #kdfOverride: Partial<Omit<ScryptKdfParams, 'algo' | 'saltB64'>> | undefined;
  readonly #open = new Map<ProfileId, OpenSessionState>();

  constructor(opts: ProfileManagerOptions) {
    this.#store = new ProfileStore(opts);
    this.#driver = opts.driver;
    this.#checkpointMs = opts.checkpointIntervalMs ?? 60_000;
    this.#autoCheckpoint = opts.autoCheckpoint ?? true;
    this.#kdfOverride = opts.kdfOverride;
  }

  get store(): ProfileStore {
    return this.#store;
  }

  // ─── Create / list / delete ──────────────────────────────────────────────

  async create(opts: CreateOptions): Promise<Profile> {
    const passphrase = await resolvePassphrase(opts.passphrase);
    const base = newManifest(opts.label, {
      ...(opts.tags ? { tags: [...opts.tags] } : {}),
      ...(opts.notes ? { notes: opts.notes } : {}),
    });
    const manifest: ProfileManifest = this.#kdfOverride
      ? { ...base, kdf: { ...base.kdf, ...this.#kdfOverride } }
      : base;
    await this.#store.writeManifest(manifest);

    // Seed an empty `data.enc` so `restoreBaseArchive` on first open works.
    const seedDir = path.join(this.#store.profileDir(manifest.id), '.seed');
    await fs.mkdir(seedDir, { recursive: true, mode: 0o700 });
    try {
      await this.#store.writeBaseArchive(manifest.id, seedDir, passphrase);
    } finally {
      await fs.rm(seedDir, { recursive: true, force: true }).catch(() => undefined);
    }

    return manifestToProfile(manifest);
  }

  async list(): Promise<readonly Profile[]> {
    const ids = await this.#store.listIds();
    const out: Profile[] = [];
    for (const id of ids) {
      const m = await this.#store.readManifest(id);
      if (m) out.push(manifestToProfile(m));
    }
    return out;
  }

  async delete(id: ProfileId): Promise<void> {
    const manifest = await this.#store.readManifest(id);
    if (!manifest) throw new Hipp0BrowserProfileNotFoundError(id);
    if (this.#open.has(id)) {
      throw new Hipp0BrowserProfileBusyError(buildBusyDiagnostic(this.#store, id, 'live'));
    }
    const lock = await this.#store.readLock(id);
    if (lock) {
      const staleness = this.#store.classifyLockStaleness(lock);
      if (staleness === 'live') {
        throw new Hipp0BrowserProfileBusyError({
          code: 'HIPP0_BROWSER_PROFILE_BUSY',
          externalCode: 'HIPP0-0502',
          owningPid: lock.pid,
          sessionStartedAt: lock.startedAt,
          host: lock.host,
          lockStaleness: staleness,
          resolutionOptions: ['wait', 'kill', 'status'],
        });
      }
    }
    await fs.rm(this.#store.profileDir(id), { recursive: true, force: true });
  }

  // ─── Status ──────────────────────────────────────────────────────────────

  async status(id: ProfileId): Promise<ProfileStatus> {
    const manifest = await this.#store.readManifest(id);
    if (!manifest) return { state: 'not_found', id };
    if (this.#open.has(id)) {
      return { state: 'open', id, diagnostic: buildBusyDiagnostic(this.#store, id, 'live') };
    }
    const lock = await this.#store.readLock(id);
    if (lock) {
      const staleness = this.#store.classifyLockStaleness(lock);
      const diagnostic: ProfileBusyDiagnostic = {
        code: 'HIPP0_BROWSER_PROFILE_BUSY',
        externalCode: 'HIPP0-0502',
        owningPid: lock.pid,
        sessionStartedAt: lock.startedAt,
        host: lock.host,
        lockStaleness: staleness,
        resolutionOptions: ['wait', 'kill', 'status'],
      };
      return { state: 'open', id, diagnostic };
    }
    return { state: 'closed', id };
  }

  // ─── Open / close + checkpoint loop ──────────────────────────────────────

  async open(id: ProfileId, passphraseProvider: PassphraseProvider): Promise<OpenedProfileHandle> {
    const manifest = await this.#store.readManifest(id);
    if (!manifest) throw new Hipp0BrowserProfileNotFoundError(id);
    if (this.#open.has(id)) {
      throw new Hipp0BrowserProfileBusyError(buildBusyDiagnostic(this.#store, id, 'live'));
    }
    const existingLock = await this.#store.readLock(id);
    if (existingLock) {
      const staleness = this.#store.classifyLockStaleness(existingLock);
      if (staleness === 'live') {
        throw new Hipp0BrowserProfileBusyError({
          code: 'HIPP0_BROWSER_PROFILE_BUSY',
          externalCode: 'HIPP0-0502',
          owningPid: existingLock.pid,
          sessionStartedAt: existingLock.startedAt,
          host: existingLock.host,
          lockStaleness: staleness,
          resolutionOptions: ['wait', 'kill', 'status'],
        });
      }
      // Stale lock — scrub will have been called at startup normally, but
      // tolerate callers who didn't run it and clean up inline.
      await this.#store.clearLock(id);
    }
    if (!this.#driver) {
      throw new Error('ProfileManager.open requires a BrowserDriver in constructor options');
    }

    const passphrase = await resolvePassphrase(passphraseProvider);

    // Decide active-dir location, restore archive, mark .active-path + LOCK.
    const activeDir = this.#store.resolveActivePath(id);
    await fs.mkdir(activeDir, { recursive: true, mode: 0o700 });
    await this.#store.restoreBaseArchive(id, activeDir, passphrase);
    await this.#store.writeActivePath(id, activeDir);
    await this.#store.writeLock(id);

    const session = await launchForProfile(activeDir, { driver: this.#driver });

    // Checkpoint loop.
    let walSeq = 0;
    const state: OpenSessionState = {
      id,
      activeDir,
      passphrase,
      session,
      walSeq,
      checkpointTimer: null,
    };
    if (this.#autoCheckpoint && this.#checkpointMs > 0) {
      state.checkpointTimer = setInterval(() => {
        void this.#tick(state);
      }, this.#checkpointMs);
      state.checkpointTimer.unref?.();
    }
    this.#open.set(id, state);

    const updated: ProfileManifest = { ...manifest, lastOpenedAt: new Date().toISOString() };
    await this.#store.writeManifest(updated);

    return {
      profile: manifestToProfile(updated),
      session,
      activeDir,
      checkpointTimer: state.checkpointTimer,
    };
  }

  async close(id: ProfileId): Promise<void> {
    const state = this.#open.get(id);
    if (!state) return;
    if (state.checkpointTimer) {
      clearInterval(state.checkpointTimer);
    }
    try {
      await closeSession(state.session);
    } finally {
      // Final checkpoint, consolidate, shred.
      await this.checkpoint(id).catch(() => undefined);
      await this.#store.consolidateOnClose(id);
      await fs.rm(state.activeDir, { recursive: true, force: true }).catch(() => undefined);
      await this.#store.clearActivePath(id).catch(() => undefined);
      await this.#store.clearLock(id).catch(() => undefined);
      const manifest = await this.#store.readManifest(id);
      if (manifest) {
        await this.#store.writeManifest({ ...manifest, lastCleanCloseAt: new Date().toISOString() });
      }
      this.#open.delete(id);
    }
  }

  /** Write an on-demand WAL checkpoint for an open profile. */
  async checkpoint(id: ProfileId): Promise<number> {
    const state = this.#open.get(id);
    if (!state) return 0;
    const nextSeq = state.walSeq + 1;
    await this.#store.writeWalCheckpoint(id, state.activeDir, state.passphrase, nextSeq);
    state.walSeq = nextSeq;
    return nextSeq;
  }

  async scrubOrphans(): Promise<ScrubReport> {
    return this.#store.scrubOrphans();
  }

  async #tick(state: OpenSessionState): Promise<void> {
    try {
      await this.checkpoint(state.id);
    } catch {
      // Swallow — checkpoint is best-effort; next tick will retry.
    }
  }
}

export function createProfileManager(opts: ProfileManagerOptions): ProfileManager {
  return new ProfileManager(opts);
}

// ─── Internals ───────────────────────────────────────────────────────────────

interface OpenSessionState {
  id: ProfileId;
  activeDir: string;
  passphrase: string;
  session: LaunchedSession;
  walSeq: number;
  checkpointTimer: NodeJS.Timeout | null;
}

async function resolvePassphrase(p: PassphraseProvider): Promise<string> {
  return typeof p === 'string' ? p : await p();
}

function manifestToProfile(m: ProfileManifest): Profile {
  return {
    id: m.id,
    label: m.label,
    createdAt: m.createdAt,
    ...(m.lastOpenedAt ? { lastOpenedAt: m.lastOpenedAt } : {}),
    ...(m.lastCleanCloseAt ? { lastCleanCloseAt: m.lastCleanCloseAt } : {}),
    ...(m.lastUncleanExitAt ? { lastUncleanExitAt: m.lastUncleanExitAt } : {}),
    ...(m.tags ? { tags: [...m.tags] } : {}),
  };
}

function buildBusyDiagnostic(
  _store: ProfileStore,
  _id: ProfileId,
  staleness: 'live' | 'likely_stale' | 'unknown',
): ProfileBusyDiagnostic {
  return {
    code: 'HIPP0_BROWSER_PROFILE_BUSY',
    externalCode: 'HIPP0-0502',
    owningPid: process.pid,
    sessionStartedAt: new Date().toISOString(),
    host: process.env['HOSTNAME'] ?? 'unknown',
    lockStaleness: staleness,
    resolutionOptions: ['wait', 'kill', 'status'],
  };
}
