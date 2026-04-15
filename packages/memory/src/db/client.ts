/**
 * Database client factory.
 *
 *   - No DATABASE_URL (or starts with `sqlite:` / `file:`)  → SQLite at ~/.hipp0/hipp0.db (default)
 *   - DATABASE_URL starts with `postgres://` / `postgresql://`  → Postgres (Phase 2.x, not yet wired)
 *
 * The returned object is a Drizzle db instance with full schema typing.
 */

import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';
import * as schema from './schema.js';

/**
 * Drizzle db instance with full schema typing. The raw better-sqlite3 handle
 * is available as `db.$client` (exposed by Drizzle's better-sqlite3 adapter).
 * Use the raw handle only for things Drizzle doesn't model: migrations, FTS5
 * virtual tables, PRAGMA reads, VACUUM.
 */
export type HipppoDb = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export interface ClientOptions {
  /**
   * Absolute or `~`-prefixed path to the SQLite file. `:memory:` is accepted.
   * Defaults to `~/.hipp0/hipp0.db`.
   */
  sqlitePath?: string;
  /**
   * If set, takes precedence over `sqlitePath`. Accepts:
   *   - `file:/abs/path.db` or `sqlite:/abs/path.db` → SQLite
   *   - `postgres://...` / `postgresql://...`       → NotImplemented (Phase 2.x)
   *   - `:memory:`                                  → in-memory SQLite
   */
  databaseUrl?: string;
  /**
   * If true, enables SQLite foreign key enforcement. Default: true.
   */
  enforceForeignKeys?: boolean;
  /**
   * If true, enables WAL mode for better concurrent-reader throughput. Default: true.
   */
  walMode?: boolean;
}

/**
 * Hipp0-prefixed error for "this code path isn't implemented in the current phase".
 * A full error hierarchy ships in packages/core/src/llm/types.ts (Phase 1e).
 */
export class Hipp0NotImplementedError extends Error {
  readonly code = 'HIPP0_NOT_IMPLEMENTED' as const;
  constructor(message: string) {
    super(message);
    this.name = 'Hipp0NotImplementedError';
  }
}

/** Expand `~` to the user's home directory. */
function expandHome(p: string): string {
  if (p === '~') return homedir();
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  return p;
}

/** Resolve the effective SQLite path from options + environment. */
export function resolveSqlitePath(opts: ClientOptions = {}): string {
  const url = opts.databaseUrl ?? process.env.DATABASE_URL;

  if (url) {
    if (url === ':memory:') return ':memory:';
    if (url.startsWith('file:')) return expandHome(url.slice('file:'.length));
    if (url.startsWith('sqlite:')) return expandHome(url.slice('sqlite:'.length));
    if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
      throw new Hipp0NotImplementedError(
        'Postgres support is deferred to Phase 2.x. Unset DATABASE_URL to use SQLite, ' +
          `or prefix with "sqlite:" / "file:" to force SQLite. Got: ${url.slice(0, 32)}...`,
      );
    }
    throw new Error(`Unrecognized DATABASE_URL scheme: ${url.slice(0, 32)}...`);
  }

  return expandHome(opts.sqlitePath ?? '~/.hipp0/hipp0.db');
}

/**
 * Create a Drizzle SQLite client. Ensures the parent directory exists.
 * Does NOT run migrations — call `runMigrations()` separately.
 */
export function createClient(opts: ClientOptions = {}): HipppoDb {
  const path = resolveSqlitePath(opts);

  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  const sqlite = new Database(path);

  if (opts.enforceForeignKeys !== false) {
    sqlite.pragma('foreign_keys = ON');
  }
  if (opts.walMode !== false && path !== ':memory:') {
    sqlite.pragma('journal_mode = WAL');
  }

  return drizzle(sqlite, { schema }) as HipppoDb;
}

/** Close the underlying SQLite handle. Safe to call multiple times. */
export function closeClient(db: HipppoDb): void {
  try {
    db.$client.close();
  } catch {
    // Already closed — ignore.
  }
}
