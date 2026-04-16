/**
 * Installer — writes a SkillBundle to disk in the LoadedSkill layout the
 * existing loader consumes, maintains a ledger at `<root>/installed.json`,
 * and supports pin / rollback.
 *
 * The installer owns zero policy decisions: every install lands with the
 * user opting in to per-tool permissions via the Phase 5.2 policy engine.
 * Runtime enforcement stays where it already is — this module just files
 * bytes onto disk.
 *
 * FS access is injected so CLI + tests can share a surface. Defaults to
 * node:fs/promises.
 */

import * as nodeFs from 'node:fs/promises';
import * as path from 'node:path';
import crypto from 'node:crypto';
import {
  Hipp0MarketplaceError,
  type InstalledSkillRecord,
  type SkillBundle,
} from './types.js';

export interface InstallerFs {
  readFile(path: string, enc: 'utf8'): Promise<string>;
  writeFile(path: string, data: string, enc: 'utf8'): Promise<void>;
  mkdir(path: string, opts: { recursive: true }): Promise<void>;
  rm(path: string, opts: { recursive: true; force: true }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  stat(path: string): Promise<{ isDirectory(): boolean }>;
}

export const defaultInstallerFs: InstallerFs = {
  readFile: (p, e) => nodeFs.readFile(p, e),
  writeFile: (p, d, e) => nodeFs.writeFile(p, d, e),
  mkdir: (p, o) => nodeFs.mkdir(p, o).then(() => undefined),
  rm: (p, o) => nodeFs.rm(p, o),
  rename: (f, t) => nodeFs.rename(f, t),
  stat: (p) => nodeFs.stat(p) as unknown as Promise<{ isDirectory(): boolean }>,
};

export interface InstallOptions {
  /** Root dir for installed skills. Usually `<home>/.hipp0/skills/`. */
  readonly root: string;
  /** Skills ledger file. Default: `<root>/installed.json`. */
  readonly ledger?: string;
  /** Override for tests. */
  readonly fs?: InstallerFs;
  /** Deterministic timestamp for tests. Default: new Date().toISOString(). */
  readonly now?: () => string;
  /** Source tag written into the record. Default: 'marketplace'. */
  readonly source?: InstalledSkillRecord['source'];
}

export async function install(
  bundle: SkillBundle,
  opts: InstallOptions,
): Promise<InstalledSkillRecord> {
  assertHashMatches(bundle);
  const fs = opts.fs ?? defaultInstallerFs;
  const root = opts.root;
  const ledger = opts.ledger ?? path.join(root, 'installed.json');
  const now = opts.now ?? (() => new Date().toISOString());
  const source = opts.source ?? 'marketplace';

  const skillDir = path.join(root, bundle.manifest.name);
  const ledgerRecords = await readLedger(fs, ledger);

  const existing = ledgerRecords.find((r) => r.name === bundle.manifest.name);
  if (existing?.pinnedVersion) {
    throw new Hipp0MarketplaceError(
      `Skill '${bundle.manifest.name}' is pinned to ${existing.pinnedVersion}; unpin before updating.`,
      'HIPP0_MARKETPLACE_PINNED',
    );
  }

  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(path.join(skillDir, 'manifest.json'), JSON.stringify(bundle.manifest, null, 2), 'utf8');
  await fs.writeFile(path.join(skillDir, 'SKILL.md'), bundle.skillMd, 'utf8');
  if (bundle.toolsSource) {
    await fs.writeFile(path.join(skillDir, 'tools.ts'), bundle.toolsSource, 'utf8');
  }

  const record: InstalledSkillRecord = {
    name: bundle.manifest.name,
    version: bundle.manifest.version,
    contentHash: bundle.contentHash,
    publisher: bundle.publisher,
    source,
    installedPath: skillDir,
    pinnedVersion: null,
    installedAt: now(),
    previousContentHash: existing?.contentHash ?? null,
    previousVersion: existing?.version ?? null,
  };

  const next = upsertRecord(ledgerRecords, record);
  await writeLedger(fs, ledger, next);
  return record;
}

export async function pin(
  name: string,
  version: string,
  opts: { root: string; ledger?: string; fs?: InstallerFs },
): Promise<InstalledSkillRecord> {
  const fs = opts.fs ?? defaultInstallerFs;
  const ledger = opts.ledger ?? path.join(opts.root, 'installed.json');
  const ledgerRecords = await readLedger(fs, ledger);
  const target = ledgerRecords.find((r) => r.name === name);
  if (!target) {
    throw new Hipp0MarketplaceError(
      `Cannot pin '${name}': not installed.`,
      'HIPP0_MARKETPLACE_NOT_INSTALLED',
    );
  }
  const updated: InstalledSkillRecord = { ...target, pinnedVersion: version };
  await writeLedger(fs, ledger, upsertRecord(ledgerRecords, updated));
  return updated;
}

export async function unpin(
  name: string,
  opts: { root: string; ledger?: string; fs?: InstallerFs },
): Promise<InstalledSkillRecord> {
  const fs = opts.fs ?? defaultInstallerFs;
  const ledger = opts.ledger ?? path.join(opts.root, 'installed.json');
  const records = await readLedger(fs, ledger);
  const target = records.find((r) => r.name === name);
  if (!target) {
    throw new Hipp0MarketplaceError(
      `Cannot unpin '${name}': not installed.`,
      'HIPP0_MARKETPLACE_NOT_INSTALLED',
    );
  }
  const updated: InstalledSkillRecord = { ...target, pinnedVersion: null };
  await writeLedger(fs, ledger, upsertRecord(records, updated));
  return updated;
}

export async function uninstall(
  name: string,
  opts: { root: string; ledger?: string; fs?: InstallerFs },
): Promise<void> {
  const fs = opts.fs ?? defaultInstallerFs;
  const ledger = opts.ledger ?? path.join(opts.root, 'installed.json');
  const records = await readLedger(fs, ledger);
  const target = records.find((r) => r.name === name);
  if (!target) return;
  await fs.rm(target.installedPath, { recursive: true, force: true });
  const next = records.filter((r) => r.name !== name);
  await writeLedger(fs, ledger, next);
}

/**
 * Roll a skill back to its previous install. Requires that the caller
 * supplies the `previousBundle` (the installer doesn't cache bundle
 * content; the CLI fetches it from the marketplace via contentHash).
 */
export async function rollback(
  name: string,
  previousBundle: SkillBundle,
  opts: InstallOptions,
): Promise<InstalledSkillRecord> {
  const fs = opts.fs ?? defaultInstallerFs;
  const ledger = opts.ledger ?? path.join(opts.root, 'installed.json');
  const records = await readLedger(fs, ledger);
  const current = records.find((r) => r.name === name);
  if (!current || current.previousContentHash !== previousBundle.contentHash) {
    throw new Hipp0MarketplaceError(
      `Rollback target for '${name}' does not match the recorded previous contentHash.`,
      'HIPP0_MARKETPLACE_ROLLBACK_MISMATCH',
    );
  }
  // Fresh install with source flagged as rollback via opts.source carry-through.
  return install(previousBundle, opts);
}

export async function listInstalled(
  opts: { root: string; ledger?: string; fs?: InstallerFs },
): Promise<readonly InstalledSkillRecord[]> {
  const fs = opts.fs ?? defaultInstallerFs;
  const ledger = opts.ledger ?? path.join(opts.root, 'installed.json');
  return readLedger(fs, ledger);
}

function assertHashMatches(bundle: SkillBundle): void {
  const canonical = JSON.stringify({
    manifest: bundle.manifest,
    skillMd: bundle.skillMd,
    toolsSource: bundle.toolsSource ?? '',
  });
  const actual = crypto.createHash('sha256').update(canonical).digest('hex');
  if (actual !== bundle.contentHash) {
    throw new Hipp0MarketplaceError(
      `contentHash mismatch (expected ${bundle.contentHash}, computed ${actual})`,
      'HIPP0_MARKETPLACE_HASH_MISMATCH',
    );
  }
}

export function computeBundleHash(bundle: Omit<SkillBundle, 'contentHash'>): string {
  const canonical = JSON.stringify({
    manifest: bundle.manifest,
    skillMd: bundle.skillMd,
    toolsSource: bundle.toolsSource ?? '',
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

async function readLedger(fs: InstallerFs, file: string): Promise<InstalledSkillRecord[]> {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw) as InstalledSkillRecord[];
  } catch {
    return [];
  }
}

async function writeLedger(
  fs: InstallerFs,
  file: string,
  records: readonly InstalledSkillRecord[],
): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(records, null, 2), 'utf8');
}

function upsertRecord(
  existing: readonly InstalledSkillRecord[],
  r: InstalledSkillRecord,
): InstalledSkillRecord[] {
  const out = existing.filter((e) => e.name !== r.name);
  out.push(r);
  return out;
}
