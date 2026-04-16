import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  fileTokenStore,
  inMemoryTokenStore,
  type OAuth2TokenSet,
} from '../../src/auth/index.js';

function sample(): OAuth2TokenSet {
  return {
    providerId: 'github',
    accessToken: 'tok',
    refreshToken: 'refr',
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    tokenType: 'Bearer',
  };
}

describe('inMemoryTokenStore', () => {
  it('round-trips set -> get -> delete', async () => {
    const s = inMemoryTokenStore();
    expect(await s.get('github', 'me')).toBeNull();
    await s.set('github', 'me', sample());
    expect((await s.get('github', 'me'))?.accessToken).toBe('tok');
    expect((await s.list())[0]).toEqual({ providerId: 'github', account: 'me' });
    expect(await s.delete('github', 'me')).toBe(true);
    expect(await s.delete('github', 'me')).toBe(false);
  });
});

describe('fileTokenStore', () => {
  it('writes one JSON per account and lists them', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hipp0-ts-'));
    try {
      const s = fileTokenStore({ baseDir: dir });
      await s.set('github', 'me', sample());
      await s.set('google', 'alt', sample());
      const list = (await s.list()).map((e) => `${e.providerId}/${e.account}`).sort();
      expect(list).toEqual(['github/me', 'google/alt']);
      expect((await s.get('github', 'me'))?.accessToken).toBe('tok');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns null for missing entries without throwing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hipp0-ts-'));
    try {
      const s = fileTokenStore({ baseDir: dir });
      expect(await s.get('github', 'nobody')).toBeNull();
      expect(await s.delete('github', 'nobody')).toBe(false);
      expect(await s.list()).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
