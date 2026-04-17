/**
 * Import a system Chrome profile directory into our managed store.
 *
 * Scope per G1-a DECISION: structural copy only. Chrome-encrypted cookies
 * stay encrypted with their original OS keyring; they won't be readable
 * by Chromium running under this user on other machines / other users.
 * Tracked as BFW-001 in docs/browser/followups.md.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  Hipp0BrowserImportLimitationNotAckedError,
  Hipp0BrowserProfileNotFoundError,
} from '../errors.js';
import { systemChromeUserDataDir, type Platform } from './paths.js';
import type { PassphraseProvider, ProfileManager } from './profile-manager.js';
import type { Profile, ProfileId } from './types.js';

export interface ImportOptions {
  readonly manager: ProfileManager;
  readonly label: string;
  readonly tags?: readonly string[];
  readonly notes?: string;
  readonly passphrase: PassphraseProvider;
  /** Must be true or the import throws `HIPP0-0506`. */
  readonly acceptCookieLimitation: boolean;
  /** Source Chrome user-data-dir path override. Default = system Chrome. */
  readonly sourceDir?: string;
  /** Name of the profile inside user-data-dir ("Default", "Profile 1"…). Default: "Default". */
  readonly profileName?: string;
  /** Platform override for tests. */
  readonly platform?: Platform;
  /** Env override for tests. */
  readonly env?: NodeJS.ProcessEnv;
}

export async function importFromChrome(opts: ImportOptions): Promise<Profile> {
  if (!opts.acceptCookieLimitation) {
    throw new Hipp0BrowserImportLimitationNotAckedError();
  }

  const platform = opts.platform ?? (process.platform as Platform);
  const userDataDir = opts.sourceDir ?? systemChromeUserDataDir(platform, opts.env);
  const profileName = opts.profileName ?? 'Default';
  const fullSource = path.join(userDataDir, profileName);

  const stat = await fs.stat(fullSource).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(
      `Chrome profile source not found: ${fullSource}. Run \`hipp0 browser profile import --help\` for path overrides.`,
    );
  }

  // Create a fresh managed profile, then overwrite its base archive with
  // the imported tree.
  const created = await opts.manager.create({
    label: opts.label,
    ...(opts.tags ? { tags: [...opts.tags] } : {}),
    ...(opts.notes ? { notes: opts.notes } : {}),
    passphrase: opts.passphrase,
  });

  const passphrase =
    typeof opts.passphrase === 'string' ? opts.passphrase : await opts.passphrase();

  await opts.manager.store.writeBaseArchive(created.id, fullSource, passphrase);

  // Ensure the manifest is readable (sanity check).
  const manifest = await opts.manager.store.readManifest(created.id);
  if (!manifest) throw new Hipp0BrowserProfileNotFoundError(created.id);

  return created;
}

/** Helper for CLI layer — constructs a confirmation prompt string. */
export function cookieLimitationWarning(platform: Platform): string {
  const keyring =
    platform === 'darwin' ? 'macOS Keychain' : platform === 'win32' ? 'Windows DPAPI' : 'libsecret';
  return `Chrome encrypts cookie values with ${keyring}. Imported profiles will retain those encrypted values but they cannot be decrypted by other users or machines. Pass --accept-cookie-limitation to confirm, or see docs/browser/profile-management.md#known-limitations. Tracked as BFW-001.`;
}

/** Wrap a `ProfileId` brand for callers coming from plain strings. */
export function asProfileId(raw: string): ProfileId {
  return raw as ProfileId;
}
