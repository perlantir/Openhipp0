/**
 * macOS Keychain adapter via the `security` CLI. Uses generic-password
 * entries (not internet-password). Keychain prompts the user for
 * confirmation on first access unless the command is whitelisted.
 */

import type { Keyring, KeyringEntry, KeyringExec } from './types.js';

export class MacOSKeyring implements Keyring {
  readonly backend = 'security' as const;

  constructor(private readonly exec: KeyringExec) {}

  async set(entry: KeyringEntry, secret: string): Promise<void> {
    // `-U` updates if present. `-w` reads password from stdin via -w<password>
    // (but to avoid arg logging, use `-w` (no value) + stdin is not supported;
    // fall back to `-w <password>` which is visible in ps listings but matches
    // how operators normally script this).
    const { code, stderr } = await this.exec.run(
      'security',
      [
        'add-generic-password',
        '-U',
        '-a',
        entry.account,
        '-s',
        entry.service,
        '-w',
        secret,
      ],
    );
    if (code !== 0) throw new Error(`security add-generic-password ${code}: ${stderr}`);
  }

  async get(entry: KeyringEntry): Promise<string | null> {
    const { stdout, code } = await this.exec.run(
      'security',
      ['find-generic-password', '-a', entry.account, '-s', entry.service, '-w'],
    );
    if (code !== 0) return null;
    return stdout.replace(/\n$/, '');
  }

  async remove(entry: KeyringEntry): Promise<void> {
    await this.exec.run(
      'security',
      ['delete-generic-password', '-a', entry.account, '-s', entry.service],
    );
  }
}
