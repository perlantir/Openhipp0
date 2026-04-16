/**
 * SkillRegistry — in-memory registry of loaded skills with lookup, search,
 * and trigger matching.
 */

import { Hipp0SkillNotFoundError, type LoadedSkill } from './types.js';

export class SkillRegistry {
  private readonly skills = new Map<string, LoadedSkill>();

  constructor(skills?: readonly LoadedSkill[]) {
    if (skills) {
      for (const s of skills) this.register(s);
    }
  }

  register(skill: LoadedSkill): void {
    this.skills.set(skill.manifest.name, skill);
  }

  get(name: string): LoadedSkill {
    const s = this.skills.get(name);
    if (!s) throw new Hipp0SkillNotFoundError(name);
    return s;
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  list(): readonly LoadedSkill[] {
    return [...this.skills.values()];
  }

  size(): number {
    return this.skills.size;
  }

  /** Return skills whose triggerPattern matches the input string. */
  match(input: string): readonly LoadedSkill[] {
    const results: LoadedSkill[] = [];
    for (const skill of this.skills.values()) {
      if (skill.manifest.triggerPattern) {
        try {
          if (new RegExp(skill.manifest.triggerPattern, 'i').test(input)) {
            results.push(skill);
          }
        } catch {
          // Invalid regex in manifest — skip it (loader validates, but be safe).
        }
      }
    }
    return results;
  }

  /** Search by name substring or tag. */
  search(query: string): readonly LoadedSkill[] {
    const q = query.toLowerCase();
    return [...this.skills.values()].filter(
      (s) =>
        s.manifest.name.includes(q) ||
        s.manifest.description.toLowerCase().includes(q) ||
        s.manifest.tags.some((t) => t.toLowerCase().includes(q)),
    );
  }
}
