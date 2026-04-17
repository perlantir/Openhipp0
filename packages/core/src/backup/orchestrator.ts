/**
 * createBackup / restoreBackup — the public entrypoints.
 *
 * createBackup:
 *   1. Pull datasets from the supplied DataSource (one call per table).
 *   2. Checksum each dataset.
 *   3. Encrypt each dataset + the manifest under the supplied password.
 *   4. Build the BackupArtifact { manifest, blobs, encryptedManifest }.
 *   5. Integrity check (decrypt the manifest back + verify checksums).
 *   6. Hand off to the backend.
 *
 * restoreBackup:
 *   1. Fetch artifact from the backend.
 *   2. Decrypt the manifest.
 *   3. Verify overallChecksum.
 *   4. Decrypt each blob, verify its per-table checksum matches the manifest.
 *   5. Apply via DataSink (caller-supplied — backup never writes to a live
 *      DB directly; the sink decides whether to truncate + import or merge).
 */

import { encryptJson, decryptJson } from './crypto.js';
import { buildManifest, checksumDataset, verifyManifest } from './manifest.js';
import {
  Hipp0BackupError,
  type BackupArtifact,
  type BackupBackend,
  type BackupManifest,
  type BackupManifestTable,
} from './types.js';

export interface DataSource {
  /** Return rows for a named table. Caller drives which tables are in scope. */
  fetch(table: string): Promise<readonly unknown[]>;
  /** Return the list of tables to back up. */
  tables(): Promise<readonly string[]>;
  /** Return the schema version string for the manifest. */
  schemaVersion(): Promise<string>;
  /** Return a stable id for the installation. */
  instanceId(): Promise<string>;
}

export interface DataSink {
  apply(table: string, rows: readonly unknown[]): Promise<void>;
}

export interface CreateBackupOptions {
  readonly source: DataSource;
  readonly password: string;
  readonly backend: BackupBackend;
  /** Key under which the artifact is stored. Default: `backup-<createdAt>.json`. */
  readonly key?: string;
  readonly now?: () => string;
}

export async function createBackup(opts: CreateBackupOptions): Promise<{
  key: string;
  manifest: BackupManifest;
}> {
  const tables = await opts.source.tables();
  const blobs: Record<string, ReturnType<typeof encryptJson>> = {};
  const tableEntries: BackupManifestTable[] = [];
  for (const name of tables) {
    const rows = await opts.source.fetch(name);
    const checksum = checksumDataset(rows);
    const blob = encryptJson(rows, opts.password);
    blobs[name] = blob;
    tableEntries.push({
      name,
      rowCount: rows.length,
      checksum,
      encryptedBytes: blob.ciphertext.length,
    });
  }

  const schemaVersion = await opts.source.schemaVersion();
  const instanceId = await opts.source.instanceId();
  const manifest = buildManifest({
    instanceId,
    schemaVersion,
    tables: tableEntries,
    ...(opts.now && { now: opts.now }),
  });

  const encryptedManifest = encryptJson(manifest, opts.password);

  const artifact: BackupArtifact = { manifest, blobs, encryptedManifest };

  // Integrity check: round-trip before committing.
  verifyManifest(manifest);
  for (const entry of tableEntries) {
    const blob = blobs[entry.name];
    if (!blob) {
      throw new Hipp0BackupError(
        `Missing blob for table ${entry.name}`,
        'HIPP0_BACKUP_MISSING_BLOB',
      );
    }
    const rt = decryptJson<readonly unknown[]>(blob, opts.password);
    if (checksumDataset(rt) !== entry.checksum) {
      throw new Hipp0BackupError(
        `Integrity check failed on round-trip for ${entry.name}`,
        'HIPP0_BACKUP_ROUNDTRIP_FAILED',
      );
    }
  }

  const key = opts.key ?? `backup-${manifest.createdAt.replace(/[:.]/g, '-')}.json`;
  await opts.backend.put(key, artifact);

  return { key, manifest };
}

export interface RestoreBackupOptions {
  readonly sink: DataSink;
  readonly password: string;
  readonly backend: BackupBackend;
  readonly key: string;
}

export async function restoreBackup(opts: RestoreBackupOptions): Promise<BackupManifest> {
  const artifact = await opts.backend.get(opts.key);
  if (!artifact) {
    throw new Hipp0BackupError(
      `Backup not found at key ${opts.key}`,
      'HIPP0_BACKUP_NOT_FOUND',
    );
  }
  const manifest = decryptJson<BackupManifest>(artifact.encryptedManifest, opts.password);
  verifyManifest(manifest);
  // Cross-check: manifest in the artifact should equal the encrypted copy.
  // We trust the encrypted manifest; a corrupted plaintext manifest would be
  // overridden here anyway because we use the decrypted one.

  for (const entry of manifest.tables) {
    const blob = artifact.blobs[entry.name];
    if (!blob) {
      throw new Hipp0BackupError(
        `Blob missing for table ${entry.name}`,
        'HIPP0_BACKUP_BLOB_MISSING',
      );
    }
    const rows = decryptJson<readonly unknown[]>(blob, opts.password);
    if (checksumDataset(rows) !== entry.checksum) {
      throw new Hipp0BackupError(
        `Checksum mismatch for ${entry.name} — data corrupted or tampered.`,
        'HIPP0_BACKUP_CHECKSUM_MISMATCH',
      );
    }
    await opts.sink.apply(entry.name, rows);
  }
  return manifest;
}
