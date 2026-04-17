/**
 * Profile-management contracts.
 *
 * Shaping decisions live in CLAUDE.md under "Phase G1-a". Summary:
 *   - Manifest is versioned forward-only; unknown versions refuse to load.
 *   - Export envelope carries explicit KDF params so scrypt tuning can change.
 *   - Concurrent-open is a hard failure with a structured diagnostic that
 *     classifies the lock as live / likely-stale / unknown.
 */

export const PROFILE_MANIFEST_VERSION = 1 as const;
export const PROFILE_EXPORT_ENVELOPE_VERSION = 1 as const;

export type ProfileId = string & { readonly __brand: 'ProfileId' };

export interface ScryptKdfParams {
  readonly algo: 'scrypt';
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly saltB64: string;
}

export interface AesGcmCipher {
  readonly algo: 'aes-256-gcm';
  readonly ivB64: string;
  readonly authTagB64: string;
  readonly ciphertextB64: string;
}

export interface ProfileManifest {
  readonly version: typeof PROFILE_MANIFEST_VERSION;
  readonly id: ProfileId;
  readonly label: string;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
  /** ISO 8601 UTC of the last successful `open()`. */
  readonly lastOpenedAt?: string;
  /** ISO 8601 UTC of the last clean `close()`. Used by orphan-scrub. */
  readonly lastCleanCloseAt?: string;
  /** ISO 8601 UTC of the last detected unclean exit (set by orphan-scrub). */
  readonly lastUncleanExitAt?: string;
  readonly kdf: ScryptKdfParams;
  readonly tags?: readonly string[];
  readonly notes?: string;
  /** Placeholder — populated by G1-e. */
  readonly fingerprint?: Readonly<Record<string, unknown>>;
  /** Placeholder — populated by G1-e. */
  readonly proxy?: Readonly<Record<string, unknown>>;
}

/** Top-level metadata returned by `list()`. */
export interface Profile {
  readonly id: ProfileId;
  readonly label: string;
  readonly createdAt: string;
  readonly lastOpenedAt?: string;
  readonly lastCleanCloseAt?: string;
  readonly lastUncleanExitAt?: string;
  readonly tags?: readonly string[];
}

/** Staleness classification for a `.active/LOCK` file. */
export type LockStaleness = 'live' | 'likely_stale' | 'unknown';

export interface ProfileBusyDiagnostic {
  readonly code: 'HIPP0_BROWSER_PROFILE_BUSY';
  readonly externalCode: 'HIPP0-0502';
  readonly owningPid: number;
  readonly sessionStartedAt: string;
  readonly host: string;
  readonly lockStaleness: LockStaleness;
  readonly resolutionOptions: readonly ['wait', 'kill', 'status'];
}

/** Discriminated status union (refinement 4). */
export type ProfileStatus =
  | { readonly state: 'closed'; readonly id: ProfileId }
  | { readonly state: 'open'; readonly id: ProfileId; readonly diagnostic: ProfileBusyDiagnostic }
  | { readonly state: 'not_found'; readonly id: ProfileId };

/** Shape of the `.active/LOCK` file on disk. */
export interface ProfileLockFile {
  readonly pid: number;
  readonly startedAt: string;
  readonly host: string;
  readonly processStartEpochMs?: number;
}

export interface OpenedProfile {
  readonly id: ProfileId;
  readonly label: string;
  /** Absolute path to the decrypted live profile dir. */
  readonly activeDir: string;
  /** Playwright `BrowserContext` (the launched browser — one Chromium per profile). */
  readonly browserHandle: unknown;
}

export type ManifestMigration = (prev: unknown) => ProfileManifest;
/** Populated as future sub-phases add manifest fields. Key = source version. */
export const MIGRATIONS: Readonly<Record<number, ManifestMigration>> = {};

export interface ProfileExportEnvelope {
  readonly version: typeof PROFILE_EXPORT_ENVELOPE_VERSION;
  readonly kdf: ScryptKdfParams;
  readonly cipher: AesGcmCipher;
  /** Manifest travels plaintext so operators can inspect before decrypting. */
  readonly manifest: ProfileManifest;
  /** ISO 8601 UTC. */
  readonly createdAt: string;
}

export interface OrphanReport {
  readonly id: ProfileId;
  /** Which archive we recovered from. */
  readonly recoveredFrom: 'wal' | 'base' | 'none';
  /** Highest WAL seq we replayed, if any. */
  readonly walSeq?: number;
  /** Estimate of how much session time was lost, in ms.
   *  `unknown` when we can't compute (no lock file or corrupted). */
  readonly lostMsEstimate: number | 'unknown';
  /** Advisory messages surfaced to the operator. */
  readonly messages: readonly string[];
}

export interface ScrubReport {
  readonly profilesChecked: number;
  readonly orphansFound: readonly OrphanReport[];
  readonly startedAt: string;
  readonly finishedAt: string;
}
