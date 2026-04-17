import { LinuxKeyring } from './linux-keyring.js';
import { MacOSKeyring } from './macos-keyring.js';
import { MemoryKeyring } from './memory-keyring.js';
import { nodeKeyringExec } from './node-exec.js';
import type { Keyring, KeyringEntry, KeyringExec } from './types.js';
import { WindowsKeyring } from './windows-keyring.js';

export { LinuxKeyring } from './linux-keyring.js';
export { MacOSKeyring } from './macos-keyring.js';
export { MemoryKeyring } from './memory-keyring.js';
export { WindowsKeyring } from './windows-keyring.js';
export { nodeKeyringExec } from './node-exec.js';
export type {
  Keyring,
  KeyringBackend,
  KeyringEntry,
  KeyringExec,
} from './types.js';

/**
 * Pick the right backend for the current platform. Operators can override
 * via `HIPP0_KEYRING_BACKEND` env (e.g. force `memory` in CI).
 */
export function createDefaultKeyring(opts: {
  readonly platform?: NodeJS.Platform;
  readonly env?: NodeJS.ProcessEnv;
  readonly exec?: KeyringExec;
} = {}): Keyring {
  const env = opts.env ?? process.env;
  const platform = opts.platform ?? process.platform;
  const exec = opts.exec ?? nodeKeyringExec;
  const override = env['HIPP0_KEYRING_BACKEND'];
  if (override === 'memory') return new MemoryKeyring();
  if (override === 'secret-tool' || platform === 'linux') return new LinuxKeyring(exec);
  if (override === 'security' || platform === 'darwin') return new MacOSKeyring(exec);
  if (override === 'dpapi' || platform === 'win32') return new WindowsKeyring(exec);
  return new MemoryKeyring();
}

/**
 * Convenience — stable entry shape for the browser profile passphrase.
 */
export function profilePassphraseEntry(profileId: string): KeyringEntry {
  return { service: 'openhipp0.browser.profile', account: profileId };
}
