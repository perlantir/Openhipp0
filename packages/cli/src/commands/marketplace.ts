/**
 * `hipp0 marketplace ...` — browse + install from a skills marketplace.
 *
 *   search [query]        — browse the index (tag/search filters)
 *   install <name>        — fetch + install by listing name
 *   pin <name> <version>  — freeze the skill at a version
 *   unpin <name>          — remove the freeze
 *   rollback <name>       — revert to the previous install
 *   list                  — show installed skills + pins
 *   uninstall <name>      — remove an installed skill
 *
 * Nothing here bypasses the Phase 1f sandbox or Phase 5.2 policy engine.
 * Every installed skill ships as untrusted code until the user grants
 * per-tool permissions.
 */

import path from 'node:path';
import { skills } from '@openhipp0/core';
import { defaultConfigDir } from '../config.js';
import { Hipp0CliError, type CommandResult } from '../types.js';

type MarketplaceClient = InstanceType<typeof skills.marketplace.MarketplaceClient>;

const { MarketplaceClient: ClientCtor, install, pin, unpin, uninstall, rollback, listInstalled } = skills.marketplace;

export interface MarketplaceOptions {
  readonly client?: MarketplaceClient;
  readonly indexUrl?: string;
  /** Root dir for installed skills. Default: `<config>/skills`. */
  readonly root?: string;
  /** Override for tests. */
  readonly fs?: skills.marketplace.InstallerFs;
  readonly now?: () => string;
}

function rootFor(opts: MarketplaceOptions): string {
  return opts.root ?? path.join(defaultConfigDir(), 'skills');
}

function makeClient(opts: MarketplaceOptions): MarketplaceClient {
  if (opts.client) return opts.client;
  return new ClientCtor(opts.indexUrl ? { indexUrl: opts.indexUrl } : {});
}

export async function runMarketplaceSearch(
  query: string | undefined,
  opts: MarketplaceOptions = {},
): Promise<CommandResult> {
  const client = makeClient(opts);
  const listings = await client.browse(query ? { search: query } : {});
  if (listings.length === 0) {
    return { exitCode: 0, stdout: ['No skills found.'], data: { listings: [] } };
  }
  const lines = [`Found ${listings.length} skill${listings.length === 1 ? '' : 's'}:`];
  for (const l of listings) {
    const rating = l.rating !== undefined ? ` ★${l.rating.toFixed(1)} (${l.ratingCount})` : '';
    const publisher = l.publisher ? ` by ${l.publisher}` : '';
    lines.push(`  ${l.name}@${l.version}${publisher}${rating} — ${l.description}`);
    if (l.tags.length > 0) lines.push(`    tags: ${l.tags.join(', ')}`);
  }
  return { exitCode: 0, stdout: lines, data: { listings } };
}

export async function runMarketplaceInstall(
  name: string,
  opts: MarketplaceOptions = {},
): Promise<CommandResult> {
  const client = makeClient(opts);
  const listing = await client.getListing(name);
  const bundle = await client.fetchBundle(listing.bundleUrl);
  const record = await install(bundle, {
    root: rootFor(opts),
    ...(opts.fs && { fs: opts.fs }),
    ...(opts.now && { now: opts.now }),
  });
  return {
    exitCode: 0,
    stdout: [
      `✓ Installed ${record.name}@${record.version} to ${record.installedPath}`,
      record.previousVersion
        ? `  Upgraded from ${record.previousVersion} — use 'hipp0 marketplace rollback ${name}' to revert.`
        : '  New install.',
    ],
    data: { record },
  };
}

export async function runMarketplacePin(
  name: string,
  version: string,
  opts: MarketplaceOptions = {},
): Promise<CommandResult> {
  const record = await pin(name, version, {
    root: rootFor(opts),
    ...(opts.fs && { fs: opts.fs }),
  });
  return {
    exitCode: 0,
    stdout: [`✓ Pinned ${record.name} to ${record.pinnedVersion}`],
    data: { record },
  };
}

export async function runMarketplaceUnpin(
  name: string,
  opts: MarketplaceOptions = {},
): Promise<CommandResult> {
  const record = await unpin(name, {
    root: rootFor(opts),
    ...(opts.fs && { fs: opts.fs }),
  });
  return { exitCode: 0, stdout: [`✓ Unpinned ${record.name}`], data: { record } };
}

export async function runMarketplaceUninstall(
  name: string,
  opts: MarketplaceOptions = {},
): Promise<CommandResult> {
  await uninstall(name, {
    root: rootFor(opts),
    ...(opts.fs && { fs: opts.fs }),
  });
  return { exitCode: 0, stdout: [`✓ Uninstalled ${name}`] };
}

export async function runMarketplaceList(opts: MarketplaceOptions = {}): Promise<CommandResult> {
  const records = await listInstalled({
    root: rootFor(opts),
    ...(opts.fs && { fs: opts.fs }),
  });
  if (records.length === 0) {
    return { exitCode: 0, stdout: ['No skills installed from the marketplace.'], data: { records } };
  }
  const lines = [`Installed skills (${records.length}):`];
  for (const r of records) {
    const pin = r.pinnedVersion ? ` [pinned ${r.pinnedVersion}]` : '';
    const prev = r.previousVersion ? `, prev ${r.previousVersion}` : '';
    lines.push(`  ${r.name}@${r.version}${pin} (${r.source}${prev})`);
  }
  return { exitCode: 0, stdout: lines, data: { records } };
}

export async function runMarketplaceRollback(
  name: string,
  opts: MarketplaceOptions = {},
): Promise<CommandResult> {
  const root = rootFor(opts);
  const records = await listInstalled({
    root,
    ...(opts.fs && { fs: opts.fs }),
  });
  const current = records.find((r) => r.name === name);
  if (!current || !current.previousContentHash || !current.previousVersion) {
    throw new Hipp0CliError(
      `Nothing to roll back for "${name}" — no previous install recorded.`,
      'HIPP0_CLI_MARKETPLACE_NOTHING_TO_ROLLBACK',
      1,
    );
  }
  // Caller must refetch the previous bundle from the marketplace by version.
  const client = makeClient(opts);
  const listing = await client.getListing(name);
  // Historical bundles are assumed to be version-addressable;
  // index implementations may not support this (MVP). Fall back by searching
  // the current bundle fetched as a simple path: `<bundleUrl>?version=<v>`.
  const versionedUrl = `${listing.bundleUrl}${listing.bundleUrl.includes('?') ? '&' : '?'}version=${encodeURIComponent(current.previousVersion)}`;
  const previousBundle = await client.fetchBundle(versionedUrl);
  const record = await rollback(name, previousBundle, {
    root,
    ...(opts.fs && { fs: opts.fs }),
    ...(opts.now && { now: opts.now }),
  });
  return {
    exitCode: 0,
    stdout: [`✓ Rolled back ${record.name} to ${record.version}`],
    data: { record },
  };
}
