import { describe, expect, it } from 'vitest';
import {
  Hipp0SkillNotFoundError,
  SkillRegistry,
  type LoadedSkill,
} from '../../src/skills/index.js';

const fakeSkill = (name: string, opts?: Partial<LoadedSkill>): LoadedSkill => ({
  manifest: {
    name,
    description: `${name} skill`,
    version: '1.0.0',
    tools: [],
    dependencies: [],
    tags: [],
    ...opts?.manifest,
  },
  dirPath: `/skills/${name}`,
  skillMd: undefined,
  source: 'workspace',
  ...opts,
});

describe('SkillRegistry', () => {
  it('register + get + has + list + size', () => {
    const reg = new SkillRegistry();
    reg.register(fakeSkill('a'));
    expect(reg.has('a')).toBe(true);
    expect(reg.get('a').manifest.name).toBe('a');
    expect(reg.list()).toHaveLength(1);
    expect(reg.size()).toBe(1);
  });

  it('constructor accepts initial skills', () => {
    const reg = new SkillRegistry([fakeSkill('a'), fakeSkill('b')]);
    expect(reg.size()).toBe(2);
  });

  it('get() throws Hipp0SkillNotFoundError on unknown name', () => {
    expect(() => new SkillRegistry().get('nope')).toThrow(Hipp0SkillNotFoundError);
  });

  it('match() returns skills whose triggerPattern matches input', () => {
    const reg = new SkillRegistry([
      fakeSkill('greet', {
        manifest: {
          name: 'greet',
          description: '',
          version: '1',
          tools: [],
          dependencies: [],
          tags: [],
          triggerPattern: '^hello',
        },
      }),
      fakeSkill('bye'),
    ]);
    expect(reg.match('hello world').map((s) => s.manifest.name)).toEqual(['greet']);
    expect(reg.match('goodbye')).toEqual([]);
  });

  it('search() filters by name substring, description, and tags', () => {
    const reg = new SkillRegistry([
      fakeSkill('web-search', {
        manifest: {
          name: 'web-search',
          description: 'Google stuff',
          version: '1',
          tools: [],
          dependencies: [],
          tags: ['search'],
        },
      }),
      fakeSkill('deploy', {
        manifest: {
          name: 'deploy',
          description: 'Ship it',
          version: '1',
          tools: [],
          dependencies: [],
          tags: ['ops'],
        },
      }),
    ]);
    expect(reg.search('search').map((s) => s.manifest.name)).toEqual(['web-search']);
    expect(reg.search('ops').map((s) => s.manifest.name)).toEqual(['deploy']);
    expect(reg.search('ship').map((s) => s.manifest.name)).toEqual(['deploy']);
  });
});
