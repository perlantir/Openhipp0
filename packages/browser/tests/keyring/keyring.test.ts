import { describe, expect, it, vi } from 'vitest';

import {
  createDefaultKeyring,
  LinuxKeyring,
  MacOSKeyring,
  MemoryKeyring,
  profilePassphraseEntry,
  WindowsKeyring,
} from '../../src/keyring/index.js';
import type { KeyringExec } from '../../src/keyring/types.js';

function mockExec(responses: Array<{ cmd: string; stdout?: string; code?: number }>): KeyringExec {
  let i = 0;
  return {
    async run(cmd) {
      const resp = responses[i++] ?? { cmd, code: 0 };
      return { stdout: resp.stdout ?? '', stderr: '', code: resp.code ?? 0 };
    },
  };
}

describe('MemoryKeyring', () => {
  it('round-trips set → get → remove', async () => {
    const k = new MemoryKeyring();
    const entry = { service: 's', account: 'a' };
    await k.set(entry, 'secret');
    expect(await k.get(entry)).toBe('secret');
    await k.remove(entry);
    expect(await k.get(entry)).toBeNull();
  });

  it('keys are scoped by (service, account)', async () => {
    const k = new MemoryKeyring();
    await k.set({ service: 'a', account: 'x' }, '1');
    await k.set({ service: 'b', account: 'x' }, '2');
    expect(await k.get({ service: 'a', account: 'x' })).toBe('1');
    expect(await k.get({ service: 'b', account: 'x' })).toBe('2');
  });
});

describe('LinuxKeyring', () => {
  it('shells secret-tool with expected args and pipes secret via stdin', async () => {
    const run = vi.fn(async () => ({ stdout: 'pw', stderr: '', code: 0 }));
    const k = new LinuxKeyring({ run });
    await k.set({ service: 's', account: 'a' }, 'super-secret');
    expect(run).toHaveBeenCalled();
    expect(run.mock.calls[0]![0]).toBe('secret-tool');
    const args = run.mock.calls[0]![1];
    expect(args).toContain('store');
    // Critical: secret must NOT appear in argv.
    expect(args.some((arg) => String(arg).includes('super-secret'))).toBe(false);
    // Secret flows through stdin.
    expect(run.mock.calls[0]![2]?.stdin).toBe('super-secret');

    const v = await k.get({ service: 's', account: 'a' });
    expect(v).toBe('pw');
  });

  it('returns null on non-zero lookup', async () => {
    const k = new LinuxKeyring(mockExec([{ cmd: 'secret-tool', code: 1 }]));
    expect(await k.get({ service: 's', account: 'a' })).toBeNull();
  });
});

describe('MacOSKeyring', () => {
  it('uses `security -w` (no value) + pipes secret via stdin (no argv leak)', async () => {
    const run = vi.fn(async () => ({ stdout: 'from-keychain', stderr: '', code: 0 }));
    const k = new MacOSKeyring({ run });
    await k.set({ service: 's', account: 'a' }, 'super-secret');
    expect(run.mock.calls[0]![0]).toBe('security');
    const args = run.mock.calls[0]![1];
    expect(args).toContain('add-generic-password');
    // `-w` is passed as a standalone flag (no value).
    const wIdx = args.indexOf('-w');
    expect(wIdx).toBeGreaterThanOrEqual(0);
    // Nothing in argv may contain the secret.
    expect(args.some((arg) => String(arg).includes('super-secret'))).toBe(false);
    // Secret flows through stdin (with confirmation duplicate).
    expect(run.mock.calls[0]![2]?.stdin).toContain('super-secret');

    const v = await k.get({ service: 's', account: 'a' });
    expect(v).toBe('from-keychain');
  });
});

describe('WindowsKeyring', () => {
  it('set/get/remove all go through powershell (unified P/Invoke path)', async () => {
    const run = vi.fn(async () => ({ stdout: 'pw', stderr: '', code: 0 }));
    const k = new WindowsKeyring({ run });
    await k.set({ service: 's', account: 'a' }, 'super-secret');
    expect(run.mock.calls[0]![0]).toBe('powershell');

    await k.get({ service: 's', account: 'a' });
    expect(run.mock.calls[1]![0]).toBe('powershell');
    await k.remove({ service: 's', account: 'a' });
    expect(run.mock.calls[2]![0]).toBe('powershell');
  });

  it('set pipes the secret via stdin (no argv leak)', async () => {
    const run = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    const k = new WindowsKeyring({ run });
    await k.set({ service: 's', account: 'a' }, 'super-secret');
    const args = run.mock.calls[0]![1];
    // None of the argv tokens may contain the secret — it goes via stdin only.
    expect(args.some((arg) => String(arg).includes('super-secret'))).toBe(false);
    expect(run.mock.calls[0]![2]?.stdin).toBe('super-secret');
    // The PowerShell script should read stdin itself.
    const cmdArg = String(args[args.length - 1]);
    expect(cmdArg).toContain('[Console]::In.ReadToEnd');
    expect(cmdArg).toContain('CredWrite');
  });

  it('set throws when PowerShell exits non-zero', async () => {
    const run = vi.fn(async () => ({ stdout: '', stderr: 'CRED_ERR', code: 1 }));
    const k = new WindowsKeyring({ run });
    await expect(k.set({ service: 's', account: 'a' }, 'secret')).rejects.toThrow(/CredWrite/);
  });
});

describe('createDefaultKeyring', () => {
  it('picks platform-appropriate backend', () => {
    const exec: KeyringExec = { async run() { return { stdout: '', stderr: '', code: 0 }; } };
    expect(createDefaultKeyring({ platform: 'linux', env: {}, exec }).backend).toBe('secret-tool');
    expect(createDefaultKeyring({ platform: 'darwin', env: {}, exec }).backend).toBe('security');
    expect(createDefaultKeyring({ platform: 'win32', env: {}, exec }).backend).toBe('credman');
  });

  it('honors HIPP0_KEYRING_BACKEND=memory for CI', () => {
    const k = createDefaultKeyring({ platform: 'linux', env: { HIPP0_KEYRING_BACKEND: 'memory' } });
    expect(k.backend).toBe('memory');
  });

  it('honors HIPP0_KEYRING_BACKEND=credman on non-Windows', () => {
    const exec: KeyringExec = { async run() { return { stdout: '', stderr: '', code: 0 }; } };
    const k = createDefaultKeyring({ platform: 'linux', env: { HIPP0_KEYRING_BACKEND: 'credman' }, exec });
    expect(k.backend).toBe('credman');
  });
});

describe('profilePassphraseEntry', () => {
  it('returns a stable entry with the profile service', () => {
    const e = profilePassphraseEntry('abc123');
    expect(e.service).toBe('openhipp0.browser.profile');
    expect(e.account).toBe('abc123');
  });

  it('rejects profileIds with shell / PowerShell meta-characters', () => {
    for (const bad of ["abc'; rm -rf /", 'abc$(evil)', 'abc"; ls', 'abc\n', 'abc `cmd`', 'abc;ls', '../x']) {
      expect(() => profilePassphraseEntry(bad)).toThrow(/invalid profileId/);
    }
  });

  it('accepts alphanumerics + _ . - : (typical hex ids)', () => {
    for (const good of ['abc123', 'a-b-c', 'a_b', 'a.b', 'prof:1']) {
      expect(() => profilePassphraseEntry(good)).not.toThrow();
    }
  });
});
