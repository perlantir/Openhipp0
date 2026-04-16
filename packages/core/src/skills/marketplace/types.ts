/**
 * Skill marketplace types.
 *
 * The marketplace is a read-through layer on top of a remote index
 * (agentskills.io by default) that produces skill bundles installable
 * into the existing `LoadedSkill` path. Open Hipp0 hosts none of this:
 * bundles come from whichever index URL the operator configures.
 *
 * A bundle is a JSON envelope, not a tarball — keeps the install path
 * dependency-free and lets operators review what they're about to
 * install byte-by-byte before accepting.
 */

import { z } from 'zod';
import { SkillManifestSchema } from '../types.js';

export const SkillBundleSchema = z.object({
  manifest: SkillManifestSchema,
  /** SKILL.md text. */
  skillMd: z.string().default(''),
  /**
   * Optional tool-definition source file. Shipped inline for auditability;
   * runtime loading still uses the normal skills/<name>/tools.ts path
   * once written to disk.
   */
  toolsSource: z.string().optional(),
  /** Publisher identity for display. Never treated as trusted by runtime. */
  publisher: z.string().optional(),
  /** SemVer or iso date — compared via string ordering for simple pin/rollback. */
  publishedAt: z.string().default(''),
  /** SHA-256 hex of the canonical bundle serialization (manifest+skillMd+toolsSource). */
  contentHash: z.string().length(64),
});

export type SkillBundle = z.infer<typeof SkillBundleSchema>;

export const MarketplaceListingSchema = z.object({
  name: z.string(),
  description: z.string(),
  version: z.string(),
  publisher: z.string().optional(),
  tags: z.array(z.string()).default([]),
  downloads: z.number().int().min(0).default(0),
  rating: z.number().min(0).max(5).optional(),
  ratingCount: z.number().int().min(0).default(0),
  bundleUrl: z.string(),
  publishedAt: z.string().default(''),
});

export type MarketplaceListing = z.infer<typeof MarketplaceListingSchema>;

export interface InstalledSkillRecord {
  name: string;
  version: string;
  contentHash: string;
  publisher: string | undefined;
  source: 'marketplace' | 'local-bundle' | 'builtin';
  /** Absolute path to the installed dir (typically `~/.hipp0/skills/<name>`). */
  installedPath: string;
  /** Frozen version the user pinned to. When non-null, auto-updates skip. */
  pinnedVersion: string | null;
  /** ISO 8601 UTC; the time of install. */
  installedAt: string;
  /** Most recent content hash prior to the last upgrade, for rollback. */
  previousContentHash: string | null;
  /** Most recent version prior to the last upgrade, for rollback. */
  previousVersion: string | null;
}

export class Hipp0MarketplaceError extends Error {
  readonly code: string;
  constructor(message: string, code = 'HIPP0_MARKETPLACE_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}
