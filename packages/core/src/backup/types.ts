/**
 * Cloud backup + restore types (Phase 24).
 *
 * Scope (per docs/PHASE_3_SCOPE.md):
 *   - AES-256-GCM + scrypt KDF; user-provided key stored in system keychain.
 *   - Two backends: S3-compatible (AWS/Backblaze/R2/Wasabi/MinIO) + local.
 *   - Daily full snapshots. Integrity check after creation.
 *   - Canonical backup manifest (tables, row counts, checksums, schema version).
 *   - Import on a fresh instance restores everything.
 *
 * Cuts (documented but NOT shipped):
 *   - Google Drive / Dropbox (OAuth compliance churn).
 *   - Incremental backup (SQLite page-deltas are hard; daily full + S3 lifecycle rules win).
 *   - BIP-39 recovery phrase (lose-it-lose-data UX).
 */

export const BACKUP_MANIFEST_VERSION = 1 as const;

export interface BackupManifestTable {
  /** Logical name of the dataset (e.g. "decisions", "sessions", "memoryEntries"). */
  readonly name: string;
  /** Number of rows / items included. */
  readonly rowCount: number;
  /** SHA-256 hex of the canonical JSON serialization of the dataset. */
  readonly checksum: string;
  /** Bytes of the encrypted ciphertext for this dataset. */
  readonly encryptedBytes: number;
}

export interface BackupManifest {
  readonly version: typeof BACKUP_MANIFEST_VERSION;
  /** ISO 8601 UTC at backup time. */
  readonly createdAt: string;
  /** Schema version of the source database (surfaced for drift detection). */
  readonly schemaVersion: string;
  /** Stable identifier for the Hipp0 installation (e.g. hostname or a UUID). */
  readonly instanceId: string;
  readonly tables: readonly BackupManifestTable[];
  /** Hex-encoded SHA-256 of concatenated per-table checksums for whole-backup validation. */
  readonly overallChecksum: string;
}

export interface EncryptedBlob {
  readonly version: 1;
  readonly salt: string; // base64
  readonly nonce: string; // base64
  readonly authTag: string; // base64
  readonly ciphertext: string; // base64
}

export interface BackupArtifact {
  readonly manifest: BackupManifest;
  /** Encrypted datasets keyed by table name. */
  readonly blobs: Record<string, EncryptedBlob>;
  /** Encrypted backup of the manifest itself (so S3 listings can't leak table names). */
  readonly encryptedManifest: EncryptedBlob;
}

export interface BackupBackend {
  /** Write artifact under the given key ("path/to/backup.json" or "<bucket>/backup-<ts>.json"). */
  put(key: string, artifact: BackupArtifact): Promise<void>;
  get(key: string): Promise<BackupArtifact | null>;
  list(prefix?: string): Promise<readonly string[]>;
  delete(key: string): Promise<void>;
}

export class Hipp0BackupError extends Error {
  readonly code: string;
  constructor(message: string, code = 'HIPP0_BACKUP_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}
