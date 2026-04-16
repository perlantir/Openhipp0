import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hipp0SkillError, loadSkills } from '../../src/skills/index.js';

describe('loadSkills', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hipp0-skills-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function writeSkill(
    baseDir: string,
    name: string,
    manifest: Record<string, unknown>,
    skillMd?: string,
  ) {
    const skillDir = path.join(baseDir, name);
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'manifest.json'),
      JSON.stringify({ name, description: `${name} skill`, ...manifest }),
      'utf8',
    );
    if (skillMd) {
      await fs.writeFile(path.join(skillDir, 'SKILL.md'), skillMd, 'utf8');
    }
  }

  it('loads a single skill from one directory', async () => {
    await writeSkill(dir, 'hello', { tags: ['demo'] }, '# Hello');
    const skills = await loadSkills({ workspace: dir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.manifest.name).toBe('hello');
    expect(skills[0]!.skillMd).toBe('# Hello');
    expect(skills[0]!.source).toBe('workspace');
  });

  it('workspace overrides global on name collision', async () => {
    const ws = path.join(dir, 'ws');
    const gl = path.join(dir, 'gl');
    await writeSkill(ws, 'greet', { version: '2.0.0' });
    await writeSkill(gl, 'greet', { version: '1.0.0' });
    const skills = await loadSkills({ workspace: ws, global: gl });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.manifest.version).toBe('2.0.0');
    expect(skills[0]!.source).toBe('workspace');
  });

  it('returns empty on non-existent directories', async () => {
    const skills = await loadSkills({ workspace: '/does/not/exist' });
    expect(skills).toEqual([]);
  });

  it('throws on invalid JSON in manifest.json', async () => {
    const skillDir = path.join(dir, 'bad');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(path.join(skillDir, 'manifest.json'), '{{not json', 'utf8');
    await expect(loadSkills({ workspace: dir })).rejects.toBeInstanceOf(Hipp0SkillError);
  });

  it('throws on invalid manifest schema', async () => {
    const skillDir = path.join(dir, 'bad');
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, 'manifest.json'),
      JSON.stringify({ name: 'BAD NAME!' }),
      'utf8',
    );
    await expect(loadSkills({ workspace: dir })).rejects.toBeInstanceOf(Hipp0SkillError);
  });

  it('skips directories without manifest.json', async () => {
    await fs.mkdir(path.join(dir, 'nomanifest'), { recursive: true });
    await writeSkill(dir, 'valid', {});
    const skills = await loadSkills({ workspace: dir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.manifest.name).toBe('valid');
  });

  it('skips _prefixed and dot-prefixed directories', async () => {
    await writeSkill(dir, '_template', {});
    await writeSkill(dir, '.hidden', {});
    await writeSkill(dir, 'visible', {});
    const skills = await loadSkills({ workspace: dir });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.manifest.name).toBe('visible');
  });
});
