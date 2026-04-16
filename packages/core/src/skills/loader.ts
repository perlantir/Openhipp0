/**
 * SkillLoader — scans skill directories in precedence order, validates each
 * manifest.json against SkillManifestSchema, and returns LoadedSkill[].
 *
 * Precedence: workspace > global > built-in. On a name collision, the
 * higher-precedence version wins silently (the lower one is dropped).
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Hipp0SkillError, SkillManifestSchema, type LoadedSkill } from './types.js';

type Source = LoadedSkill['source'];

export interface SkillPaths {
  workspace?: string;
  global?: string;
  builtin?: string;
}

export async function loadSkills(paths: SkillPaths): Promise<LoadedSkill[]> {
  const seen = new Set<string>();
  const all: LoadedSkill[] = [];

  const sources: [Source, string | undefined][] = [
    ['workspace', paths.workspace],
    ['global', paths.global],
    ['builtin', paths.builtin],
  ];

  for (const [source, dir] of sources) {
    if (!dir) continue;
    const skills = await scanDir(dir, source);
    for (const skill of skills) {
      if (seen.has(skill.manifest.name)) continue;
      seen.add(skill.manifest.name);
      all.push(skill);
    }
  }
  return all;
}

async function scanDir(dir: string, source: Source): Promise<LoadedSkill[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const results: LoadedSkill[] = [];
  for (const entry of entries) {
    if (entry.startsWith('.') || entry.startsWith('_')) continue;
    const skillDir = path.join(dir, entry);
    const stat = await fs.stat(skillDir).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const manifestPath = path.join(skillDir, 'manifest.json');
    let raw: string;
    try {
      raw = await fs.readFile(manifestPath, 'utf8');
    } catch {
      continue; // no manifest → not a skill
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Hipp0SkillError(
        `Invalid JSON in ${manifestPath}: ${(err as Error).message}`,
        'HIPP0_SKILL_MANIFEST_PARSE',
      );
    }
    const result = SkillManifestSchema.safeParse(parsed);
    if (!result.success) {
      throw new Hipp0SkillError(
        `Invalid manifest at ${manifestPath}: ${result.error.message}`,
        'HIPP0_SKILL_MANIFEST_INVALID',
      );
    }
    let skillMd: string | undefined;
    try {
      skillMd = await fs.readFile(path.join(skillDir, 'SKILL.md'), 'utf8');
    } catch {
      // No SKILL.md — optional.
    }
    results.push({ manifest: result.data, dirPath: skillDir, skillMd, source });
  }
  return results;
}
