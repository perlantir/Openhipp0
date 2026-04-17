/**
 * Profile-store — disk layout + encrypted archive + WAL checkpoints +
 * orphan scrub.
 *
 * Layout under `<root>/<id>/`:
 *   manifest.json          plaintext, versioned (PROFILE_MANIFEST_VERSION)
 *   data.enc               last clean-close archive (JSON envelope)
 *   data.wal-NNNNN.enc     in-session checkpoints, NNNNN is 5-digit seq
 *   LOCK                   JSON, present only while a session is open/crashed
 *   .active-path           optional override pointer when `.active/` is on tmpfs
 *   .active/               decrypted live Chromium user-data-dir (disk default)
 *   recovered/<iso>/       artifact when orphan-scrub recovered crashed state
 *
 * File mode: 0o700 on dirs, 0o600 on files that carry session state.
 */

import { promises as fs, readFileSync, realpathSync } from 'node:fs';
import { hostname, platform as osPlatform } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { Hipp0BrowserProfileCorruptError } from '../errors.js';
import { packDir, unpackDir } from './archive.js';
import { decryptBlob, defaultKdfParams, deriveKey, encryptBlob } from './crypto.js';
import { tmpfsCandidate, type Platform } from './paths.js';
import {
  MIGRATIONS,
  PROFILE_MANIFEST_VERSION,
  type AesGcmCipher,
  type LockStaleness,
  type OrphanReport,
  type ProfileId,
  type ProfileLockFile,
  type ProfileManifest,
  type ScrubReport,
} from './types.js';

const WAL_RETENTION = 3;
const WAL_PAD = 5;

export interface ProfileStoreOptions {
  readonly root: string;
  /** Platform override for tests. */
  readonly platform?: Platform;
  /** Env snapshot for tmpfs detection. */
  readonly env?: NodeJS.ProcessEnv;
  /** Override host for LOCK file (tests). */
  readonly hostOverride?: string;
  /** Override `process.pid` (tests). */
  readonly pidOverride?: number;
  /** Override `process.hrtime`-derived start time (tests). */
  readonly processStartEpochMsOverride?: number | null;
}

export interface OpenHandle {
  readonly id: ProfileId;
  readonly activeDir: string;
  readonly lockPath: string;
}

export class ProfileStore {
  readonly #root: string;
  readonly #platform: Platform;
  readonly #env: NodeJS.ProcessEnv;
  readonly #host: string;
  readonly #pid: number;
  readonly #processStartEpochMs: number | null;

  constructor(opts: ProfileStoreOptions) {
    this.#root = opts.root;
    this.#platform = opts.platform ?? (osPlatform() as Platform);
    this.#env = opts.env ?? process.env;
    this.#host = opts.hostOverride ?? hostname();
    this.#pid = opts.pidOverride ?? process.pid;
    this.#processStartEpochMs =
      opts.processStartEpochMsOverride !== undefined
        ? opts.processStartEpochMsOverride
        : getProcessStartEpochMs(this.#pid, this.#platform);
  }

  get root(): string {
    return this.#root;
  }

  profileDir(id: ProfileId): string {
    return path.join(this.#root, id);
  }

  // ─── Manifest ────────────────────────────────────────────────────────────

  async readManifest(id: ProfileId): Promise<ProfileManifest | null> {
    const file = path.join(this.profileDir(id), 'manifest.json');
    try {
      const buf = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(buf) as { version?: number };
      return loadManifest(parsed);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async writeManifest(manifest: ProfileManifest): Promise<void> {
    const dir = this.profileDir(manifest.id);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'manifest.json');
    const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
    await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  async listIds(): Promise<ProfileId[]> {
    try {
      const entries = await fs.readdir(this.#root, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('_'))
        .map((e) => e.name as ProfileId);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  // ─── Archive / WAL I/O ───────────────────────────────────────────────────

  /** Encrypt the given directory into `data.enc` for a profile. */
  async writeBaseArchive(id: ProfileId, srcDir: string, passphrase: string): Promise<void> {
    const manifest = await this.readManifest(id);
    if (!manifest) throw new Error(`manifest missing for ${id}`);
    const key = await deriveKey(passphrase, manifest.kdf);
    const packed = await packDir(srcDir);
    const cipher = encryptBlob(key, packed);
    await this.#writeCipher(path.join(this.profileDir(id), 'data.enc'), cipher);
  }

  /** Decrypt `data.enc` into `targetDir`. Throws if missing. */
  async restoreBaseArchive(id: ProfileId, targetDir: string, passphrase: string): Promise<void> {
    const manifest = await this.readManifest(id);
    if (!manifest) throw new Error(`manifest missing for ${id}`);
    const cipher = await this.#readCipher(path.join(this.profileDir(id), 'data.enc'));
    const key = await deriveKey(passphrase, manifest.kdf);
    const plain = decryptBlob(key, cipher);
    await unpackDir(targetDir, plain);
  }

  async writeWalCheckpoint(id: ProfileId, srcDir: string, passphrase: string, seq: number): Promise<void> {
    const manifest = await this.readManifest(id);
    if (!manifest) throw new Error(`manifest missing for ${id}`);
    const key = await deriveKey(passphrase, manifest.kdf);
    const packed = await packDir(srcDir);
    const cipher = encryptBlob(key, packed);
    const file = path.join(this.profileDir(id), `data.wal-${String(seq).padStart(WAL_PAD, '0')}.enc`);
    await this.#writeCipher(file, cipher);
    await this.#pruneWal(id, seq);
  }

  async listWalSeqs(id: ProfileId): Promise<number[]> {
    const dir = this.profileDir(id);
    try {
      const entries = await fs.readdir(dir);
      const seqs: number[] = [];
      for (const name of entries) {
        const m = /^data\.wal-(\d+)\.enc$/.exec(name);
        if (m && m[1]) seqs.push(Number(m[1]));
      }
      seqs.sort((a, b) => a - b);
      return seqs;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw err;
    }
  }

  async readWalCheckpoint(id: ProfileId, seq: number, passphrase: string): Promise<Buffer> {
    const manifest = await this.readManifest(id);
    if (!manifest) throw new Error(`manifest missing for ${id}`);
    const key = await deriveKey(passphrase, manifest.kdf);
    const file = path.join(this.profileDir(id), `data.wal-${String(seq).padStart(WAL_PAD, '0')}.enc`);
    const cipher = await this.#readCipher(file);
    return decryptBlob(key, cipher);
  }

  /**
   * Consolidate the highest-seq WAL into `data.enc` (rename-in-place) and
   * shred any remaining WAL files. Called on clean close.
   */
  async consolidateOnClose(id: ProfileId): Promise<void> {
    const seqs = await this.listWalSeqs(id);
    if (seqs.length === 0) return;
    const dir = this.profileDir(id);
    const highest = seqs[seqs.length - 1]!;
    const latest = path.join(dir, `data.wal-${String(highest).padStart(WAL_PAD, '0')}.enc`);
    const base = path.join(dir, 'data.enc');
    await fs.rename(latest, base);
    for (const seq of seqs) {
      if (seq === highest) continue;
      await fs
        .rm(path.join(dir, `data.wal-${String(seq).padStart(WAL_PAD, '0')}.enc`), { force: true })
        .catch(() => undefined);
    }
  }

  async #pruneWal(id: ProfileId, currentSeq: number): Promise<void> {
    const seqs = await this.listWalSeqs(id);
    const keepFrom = currentSeq - WAL_RETENTION + 1;
    for (const seq of seqs) {
      if (seq < keepFrom) {
        await fs
          .rm(
            path.join(this.profileDir(id), `data.wal-${String(seq).padStart(WAL_PAD, '0')}.enc`),
            { force: true },
          )
          .catch(() => undefined);
      }
    }
  }

  async #writeCipher(target: string, cipher: AesGcmCipher): Promise<void> {
    const dir = path.dirname(target);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = `${target}.tmp-${randomBytes(4).toString('hex')}`;
    await fs.writeFile(tmp, JSON.stringify(cipher), { mode: 0o600 });
    await fs.rename(tmp, target);
  }

  async #readCipher(source: string): Promise<AesGcmCipher> {
    const raw = await fs.readFile(source, 'utf8');
    const parsed = JSON.parse(raw) as AesGcmCipher;
    if (parsed.algo !== 'aes-256-gcm') {
      throw new Hipp0BrowserProfileCorruptError(`unexpected cipher algo ${String(parsed.algo)}`);
    }
    return parsed;
  }

  // ─── Active dir + LOCK ───────────────────────────────────────────────────

  /**
   * Resolve the physical `.active/` path for a profile. On Linux prefers
   * `$XDG_RUNTIME_DIR` or `/dev/shm` when present; otherwise a disk path
   * under `<profileDir>/.active/`.
   */
  resolveActivePath(id: ProfileId): string {
    const tmp = tmpfsCandidate(this.#platform, this.#env);
    if (!tmp) return path.join(this.profileDir(id), '.active');
    // Unique subdir so multiple users / runs don't collide on a shared tmpfs.
    const token = randomBytes(6).toString('hex');
    return path.join(tmp, 'hipp0-browser', `${id}-${token}`);
  }

  async writeActivePath(id: ProfileId, activePath: string): Promise<void> {
    const file = path.join(this.profileDir(id), '.active-path');
    await fs.writeFile(file, activePath, { mode: 0o600 });
  }

  async readActivePath(id: ProfileId): Promise<string | null> {
    const file = path.join(this.profileDir(id), '.active-path');
    try {
      const raw = await fs.readFile(file, 'utf8');
      return raw.trim();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async clearActivePath(id: ProfileId): Promise<void> {
    const file = path.join(this.profileDir(id), '.active-path');
    await fs.rm(file, { force: true });
  }

  async writeLock(id: ProfileId): Promise<void> {
    const lock: ProfileLockFile = {
      pid: this.#pid,
      startedAt: new Date().toISOString(),
      host: this.#host,
      ...(this.#processStartEpochMs !== null ? { processStartEpochMs: this.#processStartEpochMs } : {}),
    };
    const file = path.join(this.profileDir(id), 'LOCK');
    const tmp = `${file}.tmp-${randomBytes(4).toString('hex')}`;
    await fs.writeFile(tmp, JSON.stringify(lock, null, 2), { mode: 0o600 });
    await fs.rename(tmp, file);
  }

  async readLock(id: ProfileId): Promise<ProfileLockFile | null> {
    const file = path.join(this.profileDir(id), 'LOCK');
    try {
      const raw = await fs.readFile(file, 'utf8');
      return JSON.parse(raw) as ProfileLockFile;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  async clearLock(id: ProfileId): Promise<void> {
    await fs.rm(path.join(this.profileDir(id), 'LOCK'), { force: true });
  }

  /** Classify an on-disk lock against the current process table. */
  classifyLockStaleness(lock: ProfileLockFile): LockStaleness {
    const host = this.#host;
    if (lock.host !== host) return 'unknown';
    const alive = isPidAlive(lock.pid);
    if (!alive) return 'likely_stale';
    if (typeof lock.processStartEpochMs !== 'number') return 'unknown';
    const current = getProcessStartEpochMs(lock.pid, this.#platform);
    if (current === null) return 'unknown';
    // Allow 250ms fuzz for clock/parsing drift.
    return Math.abs(current - lock.processStartEpochMs) <= 250 ? 'live' : 'likely_stale';
  }

  // ─── Orphan scrub ────────────────────────────────────────────────────────

  async scrubOrphans(): Promise<ScrubReport> {
    const startedAt = new Date().toISOString();
    const ids = await this.listIds();
    const orphansFound: OrphanReport[] = [];
    for (const id of ids) {
      const report = await this.#scrubOne(id);
      if (report) orphansFound.push(report);
    }
    return {
      profilesChecked: ids.length,
      orphansFound,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
  }

  async #scrubOne(id: ProfileId): Promise<OrphanReport | null> {
    const lock = await this.readLock(id);
    if (!lock) return null;
    // Lock file present — was the owner alive?
    const staleness = this.classifyLockStaleness(lock);
    if (staleness === 'live') {
      // Still held by a running process; not our orphan.
      return null;
    }

    // Orphan: owning PID is gone (or reused). Recover and mark the manifest.
    const messages: string[] = [];
    let recoveredFrom: OrphanReport['recoveredFrom'] = 'none';
    let walSeq: number | undefined;

    const seqs = await this.listWalSeqs(id);
    if (seqs.length > 0) {
      const highest = seqs[seqs.length - 1]!;
      const dir = this.profileDir(id);
      const latest = path.join(dir, `data.wal-${String(highest).padStart(WAL_PAD, '0')}.enc`);
      const recoverRoot = path.join(dir, 'recovered', new Date().toISOString().replace(/[:.]/g, '-'));
      await fs.mkdir(recoverRoot, { recursive: true, mode: 0o700 });
      await fs.copyFile(latest, path.join(recoverRoot, `data.wal-${String(highest).padStart(WAL_PAD, '0')}.enc`));
      recoveredFrom = 'wal';
      walSeq = highest;
      messages.push(`preserved WAL checkpoint #${highest} under ${recoverRoot}`);
    } else {
      // No WAL — best we can offer is the existing data.enc (unchanged).
      const base = path.join(this.profileDir(id), 'data.enc');
      if (await pathExists(base)) {
        recoveredFrom = 'base';
        messages.push('no WAL checkpoints; base archive is intact');
      } else {
        messages.push('no WAL and no base archive — profile state lost');
      }
    }

    // Shred the live active-dir (tmpfs or disk) and local LOCK/active-path.
    const activePath = await this.readActivePath(id);
    if (activePath && (await pathExists(activePath))) {
      await fs.rm(activePath, { recursive: true, force: true });
      messages.push(`shredded live active dir at ${activePath}`);
    } else {
      const defaultActive = path.join(this.profileDir(id), '.active');
      if (await pathExists(defaultActive)) {
        await fs.rm(defaultActive, { recursive: true, force: true });
        messages.push(`shredded live active dir at ${defaultActive}`);
      }
    }
    await this.clearActivePath(id).catch(() => undefined);
    await this.clearLock(id);

    // Estimate loss: from lock.startedAt to now, minus the WAL cadence (60s).
    let lostMsEstimate: number | 'unknown' = 'unknown';
    try {
      const start = Date.parse(lock.startedAt);
      if (Number.isFinite(start)) {
        lostMsEstimate = Math.max(0, Date.now() - start);
        if (recoveredFrom === 'wal') {
          // WAL captures state up to ~60s before crash — loss is at most ~60s.
          lostMsEstimate = Math.min(lostMsEstimate, 60_000);
        }
      }
    } catch {
      /* leave as 'unknown' */
    }

    // Annotate the manifest with the unclean-exit timestamp.
    const manifest = await this.readManifest(id);
    if (manifest) {
      await this.writeManifest({ ...manifest, lastUncleanExitAt: new Date().toISOString() });
    }

    return {
      id,
      recoveredFrom,
      ...(walSeq !== undefined ? { walSeq } : {}),
      lostMsEstimate,
      messages,
    };
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function loadManifest(raw: { version?: number }): ProfileManifest {
  if (raw.version === PROFILE_MANIFEST_VERSION) return raw as unknown as ProfileManifest;
  if (typeof raw.version === 'number' && MIGRATIONS[raw.version]) {
    return MIGRATIONS[raw.version]!(raw);
  }
  throw new Error(
    `unsupported profile manifest version: ${String(raw.version)} (current ${PROFILE_MANIFEST_VERSION})`,
  );
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM = exists but not signal-able (still alive for our purposes).
    if ((err as NodeJS.ErrnoException).code === 'EPERM') return true;
    return false;
  }
}

/** Best-effort process-start time in epoch ms. Null when unavailable. */
function getProcessStartEpochMs(pid: number, platform: Platform): number | null {
  if (platform !== 'linux') return null;
  try {
    // /proc/<pid>/stat field 22 (0-indexed 21) is starttime in clock ticks
    // since system boot. /proc/uptime gives current uptime in seconds.
    // We use realpathSync to ensure /proc is the real procfs.
    const uptimeCanonical = realpathSync('/proc/uptime');
    if (uptimeCanonical !== '/proc/uptime') return null;
    const statRaw = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const uptimeRaw = readFileSync('/proc/uptime', 'utf8');
    // PID comm may contain spaces + parens; starttime is after the second ')'.
    const rparen = statRaw.lastIndexOf(')');
    if (rparen < 0) return null;
    const rest = statRaw.slice(rparen + 2).split(' ');
    // field 22 (starttime): 0-index (22 - 3) = 19 in the tail after comm+state
    const clockTicksRaw = rest[19];
    if (!clockTicksRaw) return null;
    const clockTicks = Number(clockTicksRaw);
    const uptimeSec = Number(uptimeRaw.split(' ')[0]);
    if (!Number.isFinite(clockTicks) || !Number.isFinite(uptimeSec)) return null;
    // Assume HZ=100 (virtually universal on modern Linux).
    const HZ = 100;
    const procUpSec = clockTicks / HZ;
    const bootMs = Date.now() - Math.round(uptimeSec * 1000);
    return bootMs + Math.round(procUpSec * 1000);
  } catch {
    return null;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

/** Creates a fresh manifest with a random ID + default KDF params. */
export function newManifest(label: string, opts?: { tags?: string[]; notes?: string }): ProfileManifest {
  const id = randomBytes(8).toString('hex') as ProfileId;
  const base: ProfileManifest = {
    version: PROFILE_MANIFEST_VERSION,
    id,
    label,
    createdAt: new Date().toISOString(),
    kdf: defaultKdfParams(),
    ...(opts?.tags ? { tags: opts.tags } : {}),
    ...(opts?.notes ? { notes: opts.notes } : {}),
  };
  return base;
}
