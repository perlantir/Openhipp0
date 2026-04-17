/**
 * macOS Keychain adapter via the `security` CLI. Uses generic-password
 * entries (not internet-password). Keychain prompts the user for
 * confirmation on first access unless the command is whitelisted.
 *
 * Secret handling: `security add-generic-password -w` (no value) reads
 * the password interactively from stdin on macOS 10.13+. We pipe the
 * secret + newline via KeyringExec's stdin so it never appears in
 * argv / `ps` listings. A second copy is piped for the confirmation
 * prompt the interactive path emits.
 */

import type { Keyring, KeyringEntry, KeyringExec } from './types.js';

export class MacOSKeyring implements Keyring {
  readonly backend = 'security' as const;

  constructor(private readonly exec: KeyringExec) {}

  async set(entry: KeyringEntry, secret: string): Promise<void> {
    // `-U` updates if present. `-w` with no value → interactive stdin
    // prompt. Two copies separated by newlines handle both the primary
    // prompt and the confirmation re-prompt on fresh adds. Prevents
    // the secret from leaking into argv.
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
      ],
      { stdin: `${secret}\n${secret}\n` },
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
