import crypto from 'node:crypto';
import {
  BACKUP_MANIFEST_VERSION,
  Hipp0BackupError,
  type BackupManifest,
  type BackupManifestTable,
} from './types.js';

/**
 * Compute the canonical SHA-256 of a dataset — a deterministic JSON
 * serialization sorted by keys, so two semantically-equal datasets always
 * produce the same checksum regardless of row order from SQLite.
 */
export function checksumDataset(rows: readonly unknown[]): string {
  const canonical = stableStringify(rows);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function buildManifest(input: {
  readonly instanceId: string;
  readonly schemaVersion: string;
  readonly tables: readonly BackupManifestTable[];
  readonly now?: () => string;
}): BackupManifest {
  const createdAt = (input.now ?? (() => new Date().toISOString()))();
  const overallChecksum = crypto
    .createHash('sha256')
    .update(input.tables.map((t) => `${t.name}:${t.checksum}`).join('|'))
    .digest('hex');
  return {
    version: BACKUP_MANIFEST_VERSION,
    createdAt,
    schemaVersion: input.schemaVersion,
    instanceId: input.instanceId,
    tables: input.tables,
    overallChecksum,
  };
}

export function verifyManifest(manifest: BackupManifest): void {
  if (manifest.version !== BACKUP_MANIFEST_VERSION) {
    throw new Hipp0BackupError(
      `Unsupported manifest version ${manifest.version}`,
      'HIPP0_BACKUP_MANIFEST_VERSION',
    );
  }
  const expected = crypto
    .createHash('sha256')
    .update(manifest.tables.map((t) => `${t.name}:${t.checksum}`).join('|'))
    .digest('hex');
  if (expected !== manifest.overallChecksum) {
    throw new Hipp0BackupError(
      'Manifest checksum mismatch — backup is corrupt or tampered.',
      'HIPP0_BACKUP_MANIFEST_TAMPERED',
    );
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify((value as Record<string, unknown>)[k])}`)
    .join(',')}}`;
}
