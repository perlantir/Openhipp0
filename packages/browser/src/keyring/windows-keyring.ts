/**
 * Windows Credential Manager adapter via PowerShell + P/Invoke to
 * `advapi32.CredWrite / CredRead / CredDelete`. Uses generic credentials
 * (`CRED_TYPE_GENERIC`, target `openhipp0:<service>:<account>`).
 *
 * Secrets flow through PowerShell stdin (`[Console]::In.ReadToEnd()`)
 * so the raw secret never appears in argv / Get-Process listings. The
 * reviewer-requested cleanup collapses the earlier mixed approach
 * (cmdkey + CredMan module) to a single P/Invoke path consistent
 * with `get()`.
 *
 * Note: this is Credential Manager (`advapi32.Cred*`), not DPAPI
 * (`dpapi.CryptProtectData`). Backend label is `credman`.
 */

import type { Keyring, KeyringEntry, KeyringExec } from './types.js';

function targetOf(entry: KeyringEntry): string {
  return `openhipp0:${entry.service}:${entry.account}`;
}

/** Shared P/Invoke type-definition header. */
const CREDMAN_TYPES = String.raw`
using System;
using System.Runtime.InteropServices;
public static class Cred {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public struct CREDENTIAL {
    public uint Flags;
    public uint Type;
    public IntPtr TargetName;
    public IntPtr Comment;
    public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
    public uint CredentialBlobSize;
    public IntPtr CredentialBlob;
    public uint Persist;
    public uint AttributeCount;
    public IntPtr Attributes;
    public IntPtr TargetAlias;
    public IntPtr UserName;
  }
  [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredWrite([In] ref CREDENTIAL cred, uint flags);
  [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredRead(string target, uint type, uint flags, out IntPtr credPtr);
  [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CredDelete(string target, uint type, uint flags);
  [DllImport("advapi32.dll")]
  public static extern void CredFree(IntPtr buffer);
}
`;

function setScript(target: string, account: string): string {
  const t = target.replace(/'/g, "''");
  const a = account.replace(/'/g, "''");
  return (
    `Add-Type -TypeDefinition @'\n${CREDMAN_TYPES}\n'@\n` +
    `$secret = [Console]::In.ReadToEnd().TrimEnd("\`n","\`r")\n` +
    `$bytes = [System.Text.Encoding]::Unicode.GetBytes($secret)\n` +
    `$blob = [System.Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)\n` +
    `[System.Runtime.InteropServices.Marshal]::Copy($bytes, 0, $blob, $bytes.Length)\n` +
    `$targetPtr = [System.Runtime.InteropServices.Marshal]::StringToHGlobalUni('${t}')\n` +
    `$userPtr = [System.Runtime.InteropServices.Marshal]::StringToHGlobalUni('${a}')\n` +
    `$cred = New-Object Cred+CREDENTIAL\n` +
    `$cred.Type = 1\n` +
    `$cred.TargetName = $targetPtr\n` +
    `$cred.UserName = $userPtr\n` +
    `$cred.CredentialBlobSize = $bytes.Length\n` +
    `$cred.CredentialBlob = $blob\n` +
    `$cred.Persist = 2\n` +
    `$ok = [Cred]::CredWrite([ref]$cred, 0)\n` +
    `[System.Runtime.InteropServices.Marshal]::FreeHGlobal($blob)\n` +
    `[System.Runtime.InteropServices.Marshal]::FreeHGlobal($targetPtr)\n` +
    `[System.Runtime.InteropServices.Marshal]::FreeHGlobal($userPtr)\n` +
    `if (-not $ok) { exit 1 }\n`
  );
}

function getScript(target: string): string {
  const t = target.replace(/'/g, "''");
  return (
    `Add-Type -TypeDefinition @'\n${CREDMAN_TYPES}\n'@\n` +
    `$ptr = [IntPtr]::Zero\n` +
    `$ok = [Cred]::CredRead('${t}', 1, 0, [ref]$ptr)\n` +
    `if (-not $ok) { exit 1 }\n` +
    `$cred = [System.Runtime.InteropServices.Marshal]::PtrToStructure($ptr, [Cred+CREDENTIAL])\n` +
    `$bytes = New-Object byte[] $cred.CredentialBlobSize\n` +
    `[System.Runtime.InteropServices.Marshal]::Copy($cred.CredentialBlob, $bytes, 0, $cred.CredentialBlobSize)\n` +
    `$out = [System.Text.Encoding]::Unicode.GetString($bytes)\n` +
    `[Cred]::CredFree($ptr)\n` +
    `Write-Output $out\n`
  );
}

function deleteScript(target: string): string {
  const t = target.replace(/'/g, "''");
  return (
    `Add-Type -TypeDefinition @'\n${CREDMAN_TYPES}\n'@\n` +
    `$ok = [Cred]::CredDelete('${t}', 1, 0)\n` +
    `if (-not $ok) { exit 1 }\n`
  );
}

export class WindowsKeyring implements Keyring {
  readonly backend = 'credman' as const;

  constructor(private readonly exec: KeyringExec) {}

  async set(entry: KeyringEntry, secret: string): Promise<void> {
    const { code, stderr } = await this.exec.run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', setScript(targetOf(entry), entry.account)],
      { stdin: secret },
    );
    if (code !== 0) throw new Error(`CredWrite failed (${code}): ${stderr}`);
  }

  async get(entry: KeyringEntry): Promise<string | null> {
    const { stdout, code } = await this.exec.run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', getScript(targetOf(entry))],
    );
    if (code !== 0) return null;
    return stdout.replace(/\r?\n$/, '');
  }

  async remove(entry: KeyringEntry): Promise<void> {
    // CredDelete returns non-zero on NOT_FOUND; treat absence as idempotent.
    await this.exec.run(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-Command', deleteScript(targetOf(entry))],
    );
  }
}
