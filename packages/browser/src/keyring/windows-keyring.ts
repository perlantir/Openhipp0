/**
 * Windows Credential Manager adapter via `cmdkey`. Simpler than DPAPI
 * raw bindings. Uses Generic Credentials (target: `openhipp0:<service>
 * :<account>`).
 *
 * Limitations: cmdkey lists credentials but doesn't print the secret —
 * retrieval requires PowerShell + CredentialManager module. We use a
 * PowerShell one-liner for `get`.
 */

import type { Keyring, KeyringEntry, KeyringExec } from './types.js';

function targetOf(entry: KeyringEntry): string {
  return `openhipp0:${entry.service}:${entry.account}`;
}

export class WindowsKeyring implements Keyring {
  readonly backend = 'dpapi' as const;

  constructor(private readonly exec: KeyringExec) {}

  async set(entry: KeyringEntry, secret: string): Promise<void> {
    const { code, stderr } = await this.exec.run(
      'cmdkey',
      [`/generic:${targetOf(entry)}`, `/user:${entry.account}`, `/pass:${secret}`],
    );
    if (code !== 0) throw new Error(`cmdkey ${code}: ${stderr}`);
  }

  async get(entry: KeyringEntry): Promise<string | null> {
    // CredMan PowerShell API — reads protected credentials.
    const ps = `
      $sig = @"
        [DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
        public static extern bool CredRead(string target, int type, int reservedFlag, out System.IntPtr credBuffer);
"@
      $api = Add-Type -MemberDefinition $sig -Name 'Cred' -Namespace 'Win32' -PassThru
      $ptr = [IntPtr]::Zero
      $ok = $api::CredRead('${targetOf(entry).replace(/'/g, "''")}', 1, 0, [ref]$ptr)
      if (-not $ok) { exit 1 }
      $cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [type]'Win32.Cred+CREDENTIAL')
      # Simpler fallback: use Windows Credential Manager module if available.
      Get-StoredCredential -Target '${targetOf(entry).replace(/'/g, "''")}' | Select-Object -ExpandProperty GetNetworkCredential | Select-Object -ExpandProperty Password
    `.trim();
    const { stdout, code } = await this.exec.run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', ps],
    );
    if (code !== 0) return null;
    return stdout.trim().length > 0 ? stdout.replace(/\r?\n$/, '') : null;
  }

  async remove(entry: KeyringEntry): Promise<void> {
    await this.exec.run('cmdkey', [`/delete:${targetOf(entry)}`]);
  }
}
