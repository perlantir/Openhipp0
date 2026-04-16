import { describe, it, expect } from 'vitest';
import { createPkceVerifier, deriveChallenge } from '../../src/auth/pkce.js';

describe('PKCE', () => {
  it('produces a verifier of the right length + charset', () => {
    const v = createPkceVerifier();
    expect(v.length).toBeGreaterThanOrEqual(43);
    expect(v.length).toBeLessThanOrEqual(128);
    expect(v).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('derives a deterministic base64url SHA-256 challenge', () => {
    const v = 'test-verifier';
    const c1 = deriveChallenge(v);
    const c2 = deriveChallenge(v);
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(c1).not.toContain('=');
  });

  it('rejects verifier lengths outside 32–96 raw bytes', () => {
    expect(() => createPkceVerifier(16)).toThrow(/length/);
    expect(() => createPkceVerifier(128)).toThrow(/length/);
  });
});
