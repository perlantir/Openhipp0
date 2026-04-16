/**
 * Skills system types + Zod schema for manifest.json validation.
 *
 * Each skill ships:
 *   skills/<name>/
 *     manifest.json — validated against SkillManifestSchema
 *     SKILL.md      — natural-language spec for the LLM
 *     tools.ts      — optional tool definitions (loaded by the engine at runtime)
 *
 * Loader precedence (workspace > global > built-in) ensures project-local
 * skills shadow global ones, which in turn shadow package-bundled ones.
 */

import { z } from 'zod';

export const SkillManifestSchema = z.object({
  name: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_-]+$/, 'lowercase-slug only'),
  description: z.string().min(1),
  version: z.string().default('0.0.0'),
  /** Regex trigger pattern. If absent, the skill must be invoked explicitly. */
  triggerPattern: z.string().optional(),
  /** Tool names the skill requires — validated against the ToolRegistry at load. */
  tools: z.array(z.string()).default([]),
  dependencies: z.array(z.string()).default([]),
  author: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export interface LoadedSkill {
  /** From manifest. */
  manifest: SkillManifest;
  /** Absolute path to the skill directory on disk. */
  dirPath: string;
  /** Contents of SKILL.md (if present). */
  skillMd: string | undefined;
  /** Precedence source where this skill was found. */
  source: 'workspace' | 'global' | 'builtin';
}

export class Hipp0SkillError extends Error {
  readonly code: string;
  constructor(message: string, code = 'HIPP0_SKILL_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class Hipp0SkillNotFoundError extends Hipp0SkillError {
  constructor(name: string) {
    super(`Skill not found: ${name}`, 'HIPP0_SKILL_NOT_FOUND');
  }
}
