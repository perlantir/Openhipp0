/**
 * Linux libsecret keyring adapter via the `secret-tool` CLI.
 * Requires `secret-tool` on PATH (package `libsecret-tools` on
 * Debian / `libsecret` on Arch).
 */

import type { Keyring, KeyringEntry, KeyringExec } from './types.js';

export class LinuxKeyring implements Keyring {
  readonly backend = 'secret-tool' as const;

  constructor(private readonly exec: KeyringExec) {}

  async set(entry: KeyringEntry, secret: string): Promise<void> {
    const { code, stderr } = await this.exec.run(
      'secret-tool',
      ['store', '--label', `${entry.service} (${entry.account})`, 'service', entry.service, 'account', entry.account],
      { stdin: secret },
    );
    if (code !== 0) throw new Error(`secret-tool store ${code}: ${stderr}`);
  }

  async get(entry: KeyringEntry): Promise<string | null> {
    const { stdout, code } = await this.exec.run(
      'secret-tool',
      ['lookup', 'service', entry.service, 'account', entry.account],
    );
    if (code !== 0) return null;
    return stdout.replace(/\n$/, '');
  }

  async remove(entry: KeyringEntry): Promise<void> {
    // secret-tool clear doesn't error on absence.
    await this.exec.run(
      'secret-tool',
      ['clear', 'service', entry.service, 'account', entry.account],
    );
  }
}
