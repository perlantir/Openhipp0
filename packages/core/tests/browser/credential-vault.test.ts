import { describe, it, expect } from 'vitest';
import {
  CredentialVault,
  inMemoryBackend,
  secureEqual,
} from '../../src/browser/credential-vault.js';

describe('CredentialVault', () => {
  it('round-trips credentials under AES-256-GCM', async () => {
    const backend = inMemoryBackend();
    const vault = new CredentialVault('correct-horse-battery-staple', backend);
    await vault.store({
      site: 'example.com',
      username: 'me',
      password: 'hunter2',
      updatedAt: new Date().toISOString(),
    });
    const got = await vault.get('example.com');
    expect(got?.username).toBe('me');
    expect(got?.password).toBe('hunter2');
  });

  it('throws on wrong master password', async () => {
    const backend = inMemoryBackend();
    const writer = new CredentialVault('pw-a', backend);
    await writer.store({ site: 'x', updatedAt: 'now' });

    const reader = new CredentialVault('pw-b', backend);
    await expect(reader.get('x')).rejects.toThrow(/decrypt|tampered|wrong/);
  });

  it('lists only stored sites', async () => {
    const vault = new CredentialVault('pw', inMemoryBackend());
    await vault.store({ site: 'a.com', updatedAt: 'now' });
    await vault.store({ site: 'b.com', updatedAt: 'now' });
    expect((await vault.list()).sort()).toEqual(['a.com', 'b.com']);
  });

  it('deletes a site', async () => {
    const vault = new CredentialVault('pw', inMemoryBackend());
    await vault.store({ site: 'a.com', updatedAt: 'now' });
    expect(await vault.delete('a.com')).toBe(true);
    expect(await vault.delete('a.com')).toBe(false);
    expect(await vault.get('a.com')).toBeNull();
  });

  it('requires a non-empty master password', () => {
    expect(() => new CredentialVault('', inMemoryBackend())).toThrow(/master password/);
  });

  it('secureEqual compares constant-time', () => {
    expect(secureEqual('abc', 'abc')).toBe(true);
    expect(secureEqual('abc', 'abd')).toBe(false);
    expect(secureEqual('abc', 'abcd')).toBe(false);
  });
});
