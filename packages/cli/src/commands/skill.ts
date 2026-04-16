/**
 * `hipp0 skill ...` — skill discovery + scaffolding.
 *
 *   list           — show installed skills across workspace/global/builtin dirs
 *   search <q>     — same, filtered by substring over name/description/tags
 *   audit          — load every skill; report the source-of-failure on bad manifests
 *   create <name>  — scaffold a new skill in the workspace directory
 *
 * `install / test / remove` are deferred — install requires a registry
 * protocol (Phase 8), test runs an agent loop (full runtime), remove is fs.rm
 * but semantically tied to `install`. Providing them now would mis-signal
 * availability. The command prints a "coming in Phase 8" message instead.
 */

import path from 'node:path';
import { promises as fs } from 'node:fs';
import { skills } from '@openhipp0/core';

type LoadedSkill = Awaited<ReturnType<typeof skills.loadSkills>>[number];
type SkillPaths = Parameters<typeof skills.loadSkills>[0];
const { loadSkills, Hipp0SkillError } = skills;
import { defaultConfigDir } from '../config.js';
import { Hipp0CliError, type CommandResult } from '../types.js';

export interface SkillOptions {
  paths?: SkillPaths;
  /** Used only by `create` for fs isolation in tests. */
  writeFile?: (p: string, content: string) => Promise<void>;
  mkdir?: (p: string, opts: { recursive: boolean }) => Promise<void>;
  exists?: (p: string) => Promise<boolean>;
}

export function defaultSkillPaths(): SkillPaths {
  return {
    workspace: path.resolve(process.cwd(), 'skills'),
    global: path.join(defaultConfigDir(), 'skills'),
    // builtin: resolved by callers that ship bundled skills.
  };
}

export async function runSkillList(opts: SkillOptions = {}): Promise<CommandResult> {
  const paths = opts.paths ?? defaultSkillPaths();
  const skills = await loadSkills(paths);
  return { exitCode: 0, stdout: renderSkills(skills), data: { skills } };
}

export async function runSkillSearch(
  query: string,
  opts: SkillOptions = {},
): Promise<CommandResult> {
  const paths = opts.paths ?? defaultSkillPaths();
  const all = await loadSkills(paths);
  const needle = query.toLowerCase();
  const matches = all.filter(
    (s) =>
      s.manifest.name.toLowerCase().includes(needle) ||
      s.manifest.description.toLowerCase().includes(needle) ||
      s.manifest.tags.some((t) => t.toLowerCase().includes(needle)),
  );
  return {
    exitCode: 0,
    stdout: matches.length === 0 ? [`No skills matched "${query}".`] : renderSkills(matches),
    data: { skills: matches, query },
  };
}

export async function runSkillAudit(opts: SkillOptions = {}): Promise<CommandResult> {
  const paths = opts.paths ?? defaultSkillPaths();
  try {
    const skills = await loadSkills(paths);
    return {
      exitCode: 0,
      stdout: [`✓ Audited ${skills.length} skill${skills.length === 1 ? '' : 's'} — all valid.`],
      data: { ok: true, count: skills.length },
    };
  } catch (err) {
    if (err instanceof Hipp0SkillError) {
      throw new Hipp0CliError(err.message, err.code, 1);
    }
    throw err;
  }
}

export async function runSkillCreate(
  name: string,
  opts: SkillOptions = {},
): Promise<CommandResult> {
  if (!/^[a-z0-9_-]+$/.test(name)) {
    throw new Hipp0CliError(
      `Skill name must match [a-z0-9_-]+ (got "${name}").`,
      'HIPP0_CLI_SKILL_BAD_NAME',
    );
  }
  const paths = opts.paths ?? defaultSkillPaths();
  if (!paths.workspace) {
    throw new Hipp0CliError(
      'Cannot create skill: no workspace directory configured.',
      'HIPP0_CLI_SKILL_NO_WORKSPACE',
    );
  }
  const skillDir = path.join(paths.workspace, name);
  const writeFile = opts.writeFile ?? ((p, c) => fs.writeFile(p, c, 'utf8'));
  const mkdir = opts.mkdir ?? ((p, o) => fs.mkdir(p, o).then(() => undefined));
  const exists =
    opts.exists ??
    ((p) =>
      fs
        .access(p)
        .then(() => true)
        .catch(() => false));

  if (await exists(skillDir)) {
    throw new Hipp0CliError(
      `Skill directory already exists: ${skillDir}`,
      'HIPP0_CLI_SKILL_EXISTS',
    );
  }
  await mkdir(skillDir, { recursive: true });

  const manifest = {
    name,
    description: `TODO: describe ${name}`,
    version: '0.1.0',
    tools: [],
    dependencies: [],
    tags: [],
  };
  await writeFile(path.join(skillDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(
    path.join(skillDir, 'SKILL.md'),
    `# ${name}\n\nTODO: write the natural-language spec for this skill.\n`,
  );

  return {
    exitCode: 0,
    stdout: [
      `✓ Created skill "${name}" at ${skillDir}`,
      '  Edit SKILL.md and manifest.json before committing.',
    ],
    data: { name, dirPath: skillDir },
  };
}

export async function runSkillDeferred(subcommand: string): Promise<CommandResult> {
  return {
    exitCode: 0,
    stdout: [
      `hipp0 skill ${subcommand}: deferred to Phase 8.`,
      '  install: needs a skill registry protocol.',
      '  test:    needs the full agent runtime + LLM.',
      '  remove:  paired with install; not useful alone.',
    ],
  };
}

function renderSkills(skills: readonly LoadedSkill[]): string[] {
  if (skills.length === 0) return ['No skills found.'];
  const lines: string[] = [`Found ${skills.length} skill${skills.length === 1 ? '' : 's'}:`];
  for (const s of skills) {
    lines.push(`  [${s.source}] ${s.manifest.name}@${s.manifest.version} — ${s.manifest.description}`);
    if (s.manifest.tags.length > 0) lines.push(`    tags: ${s.manifest.tags.join(', ')}`);
  }
  return lines;
}
