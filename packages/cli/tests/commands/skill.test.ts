import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  runSkillAudit,
  runSkillCreate,
  runSkillDeferred,
  runSkillList,
  runSkillSearch,
} from '../../src/commands/skill.js';
import { Hipp0CliError } from '../../src/types.js';

let testDir: string;

beforeEach(async () => {
  testDir = await fs.mkdtemp(path.join(tmpdir(), 'hipp0-cli-skill-'));
});
afterEach(async () => {
  await fs.rm(testDir, { recursive: true, force: true });
});

async function writeSkill(
  workspace: string,
  name: string,
  manifest: Record<string, unknown>,
): Promise<void> {
  const skillDir = path.join(workspace, name);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'manifest.json'), JSON.stringify(manifest));
}

describe('runSkillList', () => {
  it('reports empty when no skills found', async () => {
    const result = await runSkillList({ paths: { workspace: testDir } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout?.[0]).toMatch(/No skills/);
  });

  it('lists valid skills with source tag', async () => {
    await writeSkill(testDir, 'alpha', {
      name: 'alpha',
      description: 'First skill',
      version: '1.0.0',
    });
    await writeSkill(testDir, 'beta', {
      name: 'beta',
      description: 'Second',
      version: '0.1.0',
      tags: ['experimental'],
    });
    const result = await runSkillList({ paths: { workspace: testDir } });
    expect(result.exitCode).toBe(0);
    const joined = result.stdout?.join('\n') ?? '';
    expect(joined).toContain('alpha@1.0.0');
    expect(joined).toContain('beta@0.1.0');
    expect(joined).toContain('[workspace]');
  });
});

describe('runSkillSearch', () => {
  it('filters by name substring', async () => {
    await writeSkill(testDir, 'alpha-deploy', {
      name: 'alpha-deploy',
      description: 'Deploy an app',
    });
    await writeSkill(testDir, 'beta-lint', {
      name: 'beta-lint',
      description: 'Lint code',
    });
    const result = await runSkillSearch('deploy', { paths: { workspace: testDir } });
    expect(result.stdout?.join('\n')).toContain('alpha-deploy');
    expect(result.stdout?.join('\n')).not.toContain('beta-lint');
  });

  it('reports no matches', async () => {
    const result = await runSkillSearch('missing', { paths: { workspace: testDir } });
    expect(result.stdout?.[0]).toContain('No skills matched');
  });
});

describe('runSkillAudit', () => {
  it('reports ok on all-valid skills', async () => {
    await writeSkill(testDir, 'good', {
      name: 'good',
      description: 'Valid skill',
    });
    const result = await runSkillAudit({ paths: { workspace: testDir } });
    expect(result.exitCode).toBe(0);
    expect(result.stdout?.[0]).toContain('Audited 1');
  });

  it('throws Hipp0CliError on bad manifest', async () => {
    // Missing required `name` field.
    await writeSkill(testDir, 'bad', { description: 'missing name' });
    await expect(runSkillAudit({ paths: { workspace: testDir } })).rejects.toBeInstanceOf(
      Hipp0CliError,
    );
  });
});

describe('runSkillCreate', () => {
  it('rejects invalid skill names', async () => {
    await expect(runSkillCreate('Bad Name!', { paths: { workspace: testDir } })).rejects.toThrow(
      /match/,
    );
  });

  it('creates manifest.json and SKILL.md', async () => {
    const result = await runSkillCreate('new-skill', { paths: { workspace: testDir } });
    expect(result.exitCode).toBe(0);
    const manifestRaw = await fs.readFile(
      path.join(testDir, 'new-skill', 'manifest.json'),
      'utf8',
    );
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.name).toBe('new-skill');
    expect(manifest.version).toBe('0.1.0');
    const md = await fs.readFile(path.join(testDir, 'new-skill', 'SKILL.md'), 'utf8');
    expect(md).toContain('# new-skill');
  });

  it('refuses to overwrite existing skill directory', async () => {
    await writeSkill(testDir, 'taken', { name: 'taken', description: 'already here' });
    await expect(
      runSkillCreate('taken', { paths: { workspace: testDir } }),
    ).rejects.toThrow(/already exists/);
  });
});

describe('runSkillDeferred', () => {
  it('returns phase 8 message', async () => {
    const result = await runSkillDeferred('install');
    expect(result.exitCode).toBe(0);
    expect(result.stdout?.some((l) => l.includes('Phase 8'))).toBe(true);
  });
});
