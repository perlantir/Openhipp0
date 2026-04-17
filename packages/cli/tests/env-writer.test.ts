import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { upsertEnvKey, defaultEnvPath } from '../src/env-writer.js';

describe('upsertEnvKey', () => {
  let dir: string;
  let envPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(tmpdir(), 'hipp0-env-'));
    envPath = path.join(dir, '.env');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('creates the file when missing with mode 600', async () => {
    await upsertEnvKey(envPath, 'FOO_KEY', 'sk-test-123');
    const stat = await fs.stat(envPath);
    expect((stat.mode & 0o777).toString(8)).toBe('600');
    const content = await fs.readFile(envPath, 'utf8');
    expect(content).toBe('FOO_KEY=sk-test-123\n');
  });

  it('replaces only the matching line, preserving other keys + comments', async () => {
    await fs.writeFile(
      envPath,
      '# header comment\nFOO_KEY=old-value\nBAR_KEY=untouched\n\n# trailing\n',
    );
    await upsertEnvKey(envPath, 'FOO_KEY', 'new-value');
    const content = await fs.readFile(envPath, 'utf8');
    expect(content).toContain('FOO_KEY=new-value');
    expect(content).toContain('BAR_KEY=untouched');
    expect(content).toContain('# header comment');
    expect(content).toContain('# trailing');
    expect(content.match(/FOO_KEY=/g)?.length).toBe(1);
  });

  it('appends when key is absent', async () => {
    await fs.writeFile(envPath, 'A=1\nB=2\n');
    await upsertEnvKey(envPath, 'C', '3');
    const content = await fs.readFile(envPath, 'utf8');
    expect(content).toBe('A=1\nB=2\nC=3\n');
  });

  it('rejects invalid key names', async () => {
    await expect(upsertEnvKey(envPath, 'lower-case', 'x')).rejects.toThrow(/invalid env key/);
    await expect(upsertEnvKey(envPath, '1LEADS_DIGIT', 'x')).rejects.toThrow(/invalid env key/);
    await expect(upsertEnvKey(envPath, 'HAS SPACE', 'x')).rejects.toThrow(/invalid env key/);
  });

  it('rejects values containing newlines (prevents smuggling a second line)', async () => {
    await expect(upsertEnvKey(envPath, 'K', 'value\nK2=evil')).rejects.toThrow(/newline/);
  });

  it('re-locks to mode 600 even if file existed with looser perms', async () => {
    await fs.writeFile(envPath, 'X=1\n', { mode: 0o644 });
    await upsertEnvKey(envPath, 'X', '2');
    const stat = await fs.stat(envPath);
    expect((stat.mode & 0o777).toString(8)).toBe('600');
  });
});

describe('defaultEnvPath', () => {
  it('honors HIPP0_ENV_PATH override', () => {
    const prev = process.env['HIPP0_ENV_PATH'];
    process.env['HIPP0_ENV_PATH'] = '/tmp/custom/.env';
    try {
      expect(defaultEnvPath()).toBe('/tmp/custom/.env');
    } finally {
      if (prev === undefined) delete process.env['HIPP0_ENV_PATH'];
      else process.env['HIPP0_ENV_PATH'] = prev;
    }
  });

  it('falls back to HIPP0_HOME/.env when override absent', () => {
    const prevPath = process.env['HIPP0_ENV_PATH'];
    const prevHome = process.env['HIPP0_HOME'];
    delete process.env['HIPP0_ENV_PATH'];
    process.env['HIPP0_HOME'] = '/tmp/custom-home';
    try {
      expect(defaultEnvPath()).toBe('/tmp/custom-home/.env');
    } finally {
      if (prevPath !== undefined) process.env['HIPP0_ENV_PATH'] = prevPath;
      if (prevHome === undefined) delete process.env['HIPP0_HOME'];
      else process.env['HIPP0_HOME'] = prevHome;
    }
  });
});
