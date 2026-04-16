import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigCheck } from '../../../src/index.js';

describe('ConfigCheck', () => {
  let dir: string;
  let configPath: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hipp0-cfg-'));
    configPath = path.join(dir, 'hipp0.json');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('returns fail when the file does not exist', async () => {
    const check = new ConfigCheck({ configPath });
    const result = await check.run();
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/not found/);
    expect(result.details?.['configPath']).toBe(configPath);
  });

  it('returns fail when the file is not valid JSON', async () => {
    await fs.writeFile(configPath, '{{not json', 'utf8');
    const result = await new ConfigCheck({ configPath }).run();
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/not valid JSON/);
  });

  it('returns ok when the file parses and no validator is supplied', async () => {
    await fs.writeFile(configPath, JSON.stringify({ anything: true }), 'utf8');
    const result = await new ConfigCheck({ configPath }).run();
    expect(result.status).toBe('ok');
    expect(result.message).toMatch(/Config OK/);
  });

  it('runs the validator when supplied; ok when no issues', async () => {
    await fs.writeFile(configPath, JSON.stringify({ name: 'project' }), 'utf8');
    const check = new ConfigCheck({
      configPath,
      validate: (parsed) => {
        const obj = parsed as Record<string, unknown>;
        return obj['name'] === 'project' ? null : ['name must be "project"'];
      },
    });
    expect((await check.run()).status).toBe('ok');
  });

  it('returns fail with details.issues when the validator reports problems', async () => {
    await fs.writeFile(configPath, JSON.stringify({ wrong: true }), 'utf8');
    const check = new ConfigCheck({
      configPath,
      validate: () => ['missing required field "name"', 'invalid project type'],
    });
    const result = await check.run();
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/2 issues/);
    expect(result.details?.['issues']).toEqual([
      'missing required field "name"',
      'invalid project type',
    ]);
  });

  it('uses singular "issue" for a single issue', async () => {
    await fs.writeFile(configPath, JSON.stringify({}), 'utf8');
    const check = new ConfigCheck({ configPath, validate: () => ['oops'] });
    expect((await check.run()).message).toMatch(/1 issue\)/);
  });

  it('treats validator returning null/undefined/[] as ok', async () => {
    await fs.writeFile(configPath, JSON.stringify({}), 'utf8');
    for (const v of [() => null, () => undefined, () => [] as readonly string[]] as const) {
      const result = await new ConfigCheck({ configPath, validate: v }).run();
      expect(result.status).toBe('ok');
    }
  });

  it('honors a custom name', () => {
    const check = new ConfigCheck({ configPath, name: 'project-config' });
    expect(check.name).toBe('project-config');
  });

  it('rethrows non-ENOENT fs errors', async () => {
    // Use a path that points through a regular file → triggers ENOTDIR on read.
    await fs.writeFile(configPath, '{}', 'utf8');
    const trickyPath = path.join(configPath, 'nested.json');
    const check = new ConfigCheck({ configPath: trickyPath });
    await expect(check.run()).rejects.toThrow();
  });
});
