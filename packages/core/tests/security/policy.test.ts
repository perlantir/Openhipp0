import { describe, expect, it } from 'vitest';
import { enforce, getTemplate, ALWAYS_BLOCKED_PATHS } from '../../src/security/index.js';

describe('enforce()', () => {
  const moderate = getTemplate('moderate');
  const strict = getTemplate('strict');

  it('allows a tool whose permissions are all granted', () => {
    const result = enforce(moderate, {
      toolName: 'file_read',
      requiredPermissions: ['fs.read'],
    });
    expect(result.allowed).toBe(true);
  });

  it('denies a tool with a missing permission', () => {
    const result = enforce(strict, {
      toolName: 'shell_execute',
      requiredPermissions: ['shell.execute'],
    });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe('permission');
  });

  it('always blocks paths in ALWAYS_BLOCKED_PATHS regardless of allowedPaths', () => {
    const policy = { ...getTemplate('permissive'), allowedPaths: ['/**'] };
    const result = enforce(policy, {
      toolName: 'file_read',
      requiredPermissions: ['fs.read'],
      paths: ['~/.ssh/id_rsa'],
    });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe('path');
  });

  it('blocks paths not in allowedPaths', () => {
    const result = enforce(moderate, {
      toolName: 'file_read',
      requiredPermissions: ['fs.read'],
      paths: ['/etc/passwd'],
    });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe('path');
  });

  it('denies domains not in allowedDomains', () => {
    const policy = { ...moderate, allowedDomains: ['api.example.com'] };
    const result = enforce(policy, {
      toolName: 'web_fetch',
      requiredPermissions: ['net.fetch'],
      domains: ['evil.com'],
    });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe('domain');
  });

  it('allows wildcard domain', () => {
    const result = enforce(moderate, {
      toolName: 'web_fetch',
      requiredPermissions: ['net.fetch'],
      domains: ['anything.example.com'],
    });
    expect(result.allowed).toBe(true);
  });

  it("returns deniedBy='approval_required' when permissions pass but action needs approval", () => {
    // Use permissive (all permissions granted) + add shell.execute to requireApproval.
    const policy = { ...getTemplate('permissive'), requireApproval: ['shell.execute'] };
    const result = enforce(policy, {
      toolName: 'shell_execute',
      requiredPermissions: ['shell.execute'],
    });
    expect(result.allowed).toBe(false);
    expect(result.deniedBy).toBe('approval_required');
  });
});

describe('ALWAYS_BLOCKED_PATHS', () => {
  it('includes ssh, aws, gnupg, and hipp0 secrets', () => {
    expect(ALWAYS_BLOCKED_PATHS).toContain('~/.ssh/**');
    expect(ALWAYS_BLOCKED_PATHS).toContain('~/.aws/**');
    expect(ALWAYS_BLOCKED_PATHS).toContain('~/.gnupg/**');
    expect(ALWAYS_BLOCKED_PATHS).toContain('~/.hipp0/secrets/**');
  });
});

describe('getTemplate()', () => {
  it('returns a fresh copy (mutation-safe)', () => {
    const a = getTemplate('strict');
    a.permissions.push('bad');
    const b = getTemplate('strict');
    expect(b.permissions).not.toContain('bad');
  });
});
