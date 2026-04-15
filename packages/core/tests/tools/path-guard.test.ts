import { describe, expect, it } from 'vitest';
import {
  ALWAYS_BLOCKED_PATHS,
  assertPathAllowed,
  expandHome,
  isHostAllowed,
  isUnder,
} from '../../src/tools/path-guard.js';
import { Hipp0PathDeniedError } from '../../src/tools/types.js';

describe('expandHome', () => {
  it('expands ~', () => {
    expect(expandHome('~')).toMatch(/^\/.+/);
  });
  it('expands ~/foo', () => {
    expect(expandHome('~/foo')).toMatch(/\/foo$/);
  });
  it('leaves non-tilde paths untouched', () => {
    expect(expandHome('/abs/path')).toBe('/abs/path');
    expect(expandHome('./rel')).toBe('./rel');
  });
});

describe('isUnder', () => {
  it('same path counts as under', () => {
    expect(isUnder('/a/b', '/a/b')).toBe(true);
  });
  it('child is under parent', () => {
    expect(isUnder('/a/b', '/a/b/c/d')).toBe(true);
  });
  it('sibling is not under', () => {
    expect(isUnder('/a/b', '/a/bb')).toBe(false);
  });
  it('parent is not under child', () => {
    expect(isUnder('/a/b/c', '/a/b')).toBe(false);
  });
});

describe('assertPathAllowed', () => {
  it('allows a path inside allowedRoots', () => {
    const p = assertPathAllowed('/tmp/hipp0-test/foo.txt', {
      allowedRoots: ['/tmp/hipp0-test'],
      tool: 'file_read',
    });
    expect(p).toBe('/tmp/hipp0-test/foo.txt');
  });

  it('rejects a path outside allowedRoots', () => {
    expect(() =>
      assertPathAllowed('/etc/hosts', {
        allowedRoots: ['/tmp/hipp0-test'],
        tool: 'file_read',
      }),
    ).toThrow(Hipp0PathDeniedError);
  });

  it('rejects traversal escapes via ..', () => {
    try {
      assertPathAllowed('/tmp/hipp0-test/../../etc/passwd', {
        allowedRoots: ['/tmp/hipp0-test'],
        tool: 'file_read',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Hipp0PathDeniedError);
      expect((err as Hipp0PathDeniedError).reason).toBe('outside_allowed');
      expect((err as Hipp0PathDeniedError).path).toBe('/etc/passwd');
    }
  });

  it('always blocks ~/.ssh even if explicitly allowed', () => {
    try {
      assertPathAllowed('~/.ssh/id_rsa', {
        allowedRoots: ['~'],
        tool: 'file_read',
      });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(Hipp0PathDeniedError);
      expect((err as Hipp0PathDeniedError).reason).toBe('blocked');
    }
  });

  it('always blocks ~/.aws', () => {
    expect(() =>
      assertPathAllowed('~/.aws/credentials', { allowedRoots: ['~'], tool: 'x' }),
    ).toThrow(Hipp0PathDeniedError);
  });

  it('always blocks ~/.hipp0/secrets', () => {
    expect(() =>
      assertPathAllowed('~/.hipp0/secrets/token', { allowedRoots: ['~'], tool: 'x' }),
    ).toThrow(Hipp0PathDeniedError);
  });

  it('always blocks /etc/shadow', () => {
    expect(() => assertPathAllowed('/etc/shadow', { allowedRoots: ['/'], tool: 'x' })).toThrow(
      Hipp0PathDeniedError,
    );
  });

  it('honors extraBlocked additions', () => {
    expect(() =>
      assertPathAllowed('/tmp/hipp0-test/secret.key', {
        allowedRoots: ['/tmp/hipp0-test'],
        extraBlocked: ['/tmp/hipp0-test/secret.key'],
        tool: 'x',
      }),
    ).toThrow(Hipp0PathDeniedError);
  });

  it('ALWAYS_BLOCKED_PATHS is a non-empty readonly list', () => {
    expect(ALWAYS_BLOCKED_PATHS.length).toBeGreaterThan(0);
    expect(ALWAYS_BLOCKED_PATHS).toContain('~/.ssh');
    expect(ALWAYS_BLOCKED_PATHS).toContain('~/.hipp0/secrets');
  });
});

describe('isHostAllowed', () => {
  it('exact match allowed', () => {
    expect(isHostAllowed('example.com', ['example.com'])).toBe(true);
  });
  it('case-insensitive match', () => {
    expect(isHostAllowed('EXAMPLE.COM', ['example.com'])).toBe(true);
  });
  it('subdomain via wildcard', () => {
    expect(isHostAllowed('api.example.com', ['*.example.com'])).toBe(true);
    expect(isHostAllowed('deep.api.example.com', ['*.example.com'])).toBe(true);
  });
  it('wildcard does NOT match apex', () => {
    expect(isHostAllowed('example.com', ['*.example.com'])).toBe(false);
  });
  it('rejects unknown hosts', () => {
    expect(isHostAllowed('evil.com', ['example.com'])).toBe(false);
    expect(isHostAllowed('example.com.evil.com', ['*.example.com'])).toBe(false);
  });
  it('empty allowlist rejects everything', () => {
    expect(isHostAllowed('example.com', [])).toBe(false);
  });
});
