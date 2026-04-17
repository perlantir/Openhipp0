/**
 * OS-keyring adapter contracts. We shell out to per-OS keyring tools
 * rather than ship a native binding — `secret-tool` on Linux,
 * `security` on macOS, PowerShell + `advapi32.Cred*` on Windows.
 * Trade-off: callers need these tools installed (documented in
 * docs/browser/profile-management.md).
 */

export type KeyringBackend = 'secret-tool' | 'security' | 'credman' | 'memory';

export interface KeyringEntry {
  /** Service name (logical group). */
  readonly service: string;
  /** Account / label within the service. */
  readonly account: string;
}

export interface Keyring {
  readonly backend: KeyringBackend;
  /** Store a secret. Overwrites if already present. */
  set(entry: KeyringEntry, secret: string): Promise<void>;
  /** Retrieve a secret; returns null if not present. */
  get(entry: KeyringEntry): Promise<string | null>;
  /** Delete a secret; no-op if absent. */
  remove(entry: KeyringEntry): Promise<void>;
}

export interface KeyringExec {
  /**
   * Run a command and return `{stdout, stderr, code}`. Callers inject
   * this so tests can mock without spawning a process.
   */
  run(
    cmd: string,
    args: readonly string[],
    options?: { readonly stdin?: string; readonly env?: NodeJS.ProcessEnv },
  ): Promise<{ stdout: string; stderr: string; code: number }>;
}
