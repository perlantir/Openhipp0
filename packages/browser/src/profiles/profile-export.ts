/**
 * Portable profile bundle (`.hipp0profile`) — re-wrapped at export time so
 * the recipient never sees the exporter's passphrase. Envelope carries
 * explicit KDF params so scrypt tuning can change without breaking
 * forward compatibility.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

import { Hipp0BrowserProfileNotFoundError } from '../errors.js';
import { packDir, unpackDir } from './archive.js';
import {
  decryptBlob,
  defaultKdfParams,
  deriveKey,
  encryptBlob,
} from './crypto.js';
import type { ProfileManager } from './profile-manager.js';
import {
  PROFILE_EXPORT_ENVELOPE_VERSION,
  PROFILE_MANIFEST_VERSION,
  type Profile,
  type ProfileExportEnvelope,
  type ProfileId,
} from './types.js';

export interface ExportOptions {
  readonly manager: ProfileManager;
  readonly id: ProfileId;
  readonly outFile: string;
  /** Passphrase already on hand for the source profile (needed to decrypt). */
  readonly sourcePassphrase: string;
  /** Passphrase the recipient will use. If omitted, random is generated and returned. */
  readonly recipientPassphrase?: string;
}

export interface ExportResult {
  readonly outFile: string;
  /** Only populated when the recipient passphrase was auto-generated. */
  readonly generatedPassphrase?: string;
}

export async function exportProfile(opts: ExportOptions): Promise<ExportResult> {
  const manifest = await opts.manager.store.readManifest(opts.id);
  if (!manifest) throw new Hipp0BrowserProfileNotFoundError(opts.id);

  // Decrypt source profile into a tmp staging dir.
  const staging = path.join(
    opts.manager.store.profileDir(opts.id),
    `.export-staging-${randomBytes(4).toString('hex')}`,
  );
  await fs.mkdir(staging, { recursive: true, mode: 0o700 });
  try {
    await opts.manager.store.restoreBaseArchive(opts.id, staging, opts.sourcePassphrase);
    const packed = await packDir(staging);

    const recipientPassphrase = opts.recipientPassphrase ?? generatePassphrase();
    const kdf = defaultKdfParams();
    const key = await deriveKey(recipientPassphrase, kdf);
    const cipher = encryptBlob(key, packed);

    const envelope: ProfileExportEnvelope = {
      version: PROFILE_EXPORT_ENVELOPE_VERSION,
      kdf,
      cipher,
      manifest,
      createdAt: new Date().toISOString(),
    };

    await fs.mkdir(path.dirname(opts.outFile), { recursive: true });
    await fs.writeFile(opts.outFile, JSON.stringify(envelope, null, 2), { mode: 0o600 });

    return opts.recipientPassphrase === undefined
      ? { outFile: opts.outFile, generatedPassphrase: recipientPassphrase }
      : { outFile: opts.outFile };
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

export interface ImportBundleOptions {
  readonly manager: ProfileManager;
  readonly inFile: string;
  readonly recipientPassphrase: string;
  readonly label: string;
  readonly localPassphrase: string;
}

export async function importBundle(opts: ImportBundleOptions): Promise<Profile> {
  const raw = await fs.readFile(opts.inFile, 'utf8');
  const envelope = JSON.parse(raw) as ProfileExportEnvelope;
  if (envelope.version !== PROFILE_EXPORT_ENVELOPE_VERSION) {
    throw new Error(
      `unsupported envelope version: ${String(envelope.version)} (current ${PROFILE_EXPORT_ENVELOPE_VERSION})`,
    );
  }
  if (envelope.manifest.version !== PROFILE_MANIFEST_VERSION) {
    throw new Error(
      `bundle carries manifest v${envelope.manifest.version}; this build supports v${PROFILE_MANIFEST_VERSION}`,
    );
  }

  // Decrypt with recipient passphrase.
  const key = await deriveKey(opts.recipientPassphrase, envelope.kdf);
  const packed = decryptBlob(key, envelope.cipher);

  // Create a fresh local profile; unpack into a staging dir; encrypt with local passphrase.
  const created = await opts.manager.create({
    label: opts.label,
    ...(envelope.manifest.tags ? { tags: [...envelope.manifest.tags] } : {}),
    ...(envelope.manifest.notes ? { notes: envelope.manifest.notes } : {}),
    passphrase: opts.localPassphrase,
  });

  const staging = path.join(
    opts.manager.store.profileDir(created.id),
    `.import-staging-${randomBytes(4).toString('hex')}`,
  );
  try {
    await unpackDir(staging, packed);
    await opts.manager.store.writeBaseArchive(created.id, staging, opts.localPassphrase);
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }

  return created;
}

function generatePassphrase(): string {
  // 24 bytes ≈ 192 bits; base64 encodes to 32 chars.
  return randomBytes(24).toString('base64').replace(/[+/=]/g, '').slice(0, 32);
}

/** Re-exported helper for manifest round-trip tests. */
export function envelopeSanity(envelope: unknown): envelope is ProfileExportEnvelope {
  if (!envelope || typeof envelope !== 'object') return false;
  const e = envelope as ProfileExportEnvelope;
  return (
    e.version === PROFILE_EXPORT_ENVELOPE_VERSION &&
    e.kdf?.algo === 'scrypt' &&
    e.cipher?.algo === 'aes-256-gcm' &&
    typeof e.manifest === 'object' &&
    e.manifest?.version === PROFILE_MANIFEST_VERSION
  );
}
