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
  it('shells secret-tool with expected args', async () => {
    const run = vi.fn(async () => ({ stdout: 'pw', stderr: '', code: 0 }));
    const k = new LinuxKeyring({ run });
    await k.set({ service: 's', account: 'a' }, 'secret');
    expect(run).toHaveBeenCalled();
    expect(run.mock.calls[0]![0]).toBe('secret-tool');
    const args = run.mock.calls[0]![1];
    expect(args).toContain('store');
    expect(args).toContain('service');
    expect(args).toContain('account');

    const v = await k.get({ service: 's', account: 'a' });
    expect(v).toBe('pw');
  });

  it('returns null on non-zero lookup', async () => {
    const k = new LinuxKeyring(mockExec([{ cmd: 'secret-tool', code: 1 }]));
    expect(await k.get({ service: 's', account: 'a' })).toBeNull();
  });
});

describe('MacOSKeyring', () => {
  it('uses security add-generic-password / find-generic-password', async () => {
    const run = vi.fn(async () => ({ stdout: 'from-keychain', stderr: '', code: 0 }));
    const k = new MacOSKeyring({ run });
    await k.set({ service: 's', account: 'a' }, 'secret');
    expect(run.mock.calls[0]![0]).toBe('security');
    expect(run.mock.calls[0]![1]).toContain('add-generic-password');

    const v = await k.get({ service: 's', account: 'a' });
    expect(v).toBe('from-keychain');
  });
});

describe('WindowsKeyring', () => {
  it('uses cmdkey for set/remove, powershell for get', async () => {
    const run = vi.fn(async () => ({ stdout: 'pw', stderr: '', code: 0 }));
    const k = new WindowsKeyring({ run });
    await k.set({ service: 's', account: 'a' }, 'secret');
    expect(run.mock.calls[0]![0]).toBe('cmdkey');

    await k.get({ service: 's', account: 'a' });
    expect(run.mock.calls[1]![0]).toBe('powershell');
    await k.remove({ service: 's', account: 'a' });
    expect(run.mock.calls[2]![0]).toBe('cmdkey');
  });
});

describe('createDefaultKeyring', () => {
  it('picks platform-appropriate backend', () => {
    expect(createDefaultKeyring({ platform: 'linux', env: {}, exec: { async run() { return { stdout: '', stderr: '', code: 0 }; } } }).backend).toBe('secret-tool');
    expect(createDefaultKeyring({ platform: 'darwin', env: {}, exec: { async run() { return { stdout: '', stderr: '', code: 0 }; } } }).backend).toBe('security');
    expect(createDefaultKeyring({ platform: 'win32', env: {}, exec: { async run() { return { stdout: '', stderr: '', code: 0 }; } } }).backend).toBe('dpapi');
  });

  it('honors HIPP0_KEYRING_BACKEND=memory for CI', () => {
    const k = createDefaultKeyring({ platform: 'linux', env: { HIPP0_KEYRING_BACKEND: 'memory' } });
    expect(k.backend).toBe('memory');
  });
});

describe('profilePassphraseEntry', () => {
  it('returns a stable entry with the profile service', () => {
    const e = profilePassphraseEntry('abc123');
    expect(e.service).toBe('openhipp0.browser.profile');
    expect(e.account).toBe('abc123');
  });
});
