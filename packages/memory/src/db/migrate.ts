/**
 * Migration runner.
 *
 * Applies Drizzle-generated SQL migrations from `packages/memory/drizzle/` to the
 * given SQLite database. After migrations apply, creates the FTS5 virtual table
 * that mirrors session_history.full_text (Drizzle doesn't model virtual tables,
 * so this is raw SQL).
 *
 * Usage:
 *   import { createClient } from './client.js';
 *   import { runMigrations } from './migrate.js';
 *   const db = createClient();
 *   runMigrations(db);
 */

import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HipppoDb } from './client.js';

/** Absolute path to the `drizzle/` migrations folder, resolved relative to this file. */
export function defaultMigrationsFolder(): string {
  // this file compiles to dist/db/migrate.js; migrations live at <pkg>/drizzle/
  const here = dirname(fileURLToPath(import.meta.url));
  // src/db/migrate.ts  → ../../drizzle
  // dist/db/migrate.js → ../../drizzle
  return resolve(here, '..', '..', 'drizzle');
}

export interface MigrateOptions {
  /** Override the migrations folder (useful for tests). */
  migrationsFolder?: string;
  /** Skip the FTS5 virtual table creation. Default: false. */
  skipFts?: boolean;
}

/**
 * Apply all pending migrations + create FTS5 mirror of session_history.
 * Idempotent: safe to call on already-migrated DBs.
 */
export function runMigrations(db: HipppoDb, opts: MigrateOptions = {}): void {
  const folder = opts.migrationsFolder ?? defaultMigrationsFolder();

  if (!existsSync(folder)) {
    throw new Error(
      `Migrations folder not found: ${folder}. ` +
        `Run \`pnpm --filter @openhipp0/memory db:generate\` to generate migrations first.`,
    );
  }

  migrate(db, { migrationsFolder: folder });

  if (!opts.skipFts) {
    createFtsVirtualTable(db);
  }
}

/**
 * Create an FTS5 virtual table mirroring session_history.full_text, plus triggers
 * to keep it in sync. Idempotent.
 */
export function createFtsVirtualTable(db: HipppoDb): void {
  db.$client.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS session_history_fts USING fts5(
      full_text,
      content='session_history',
      content_rowid='rowid'
    );

    CREATE TRIGGER IF NOT EXISTS session_history_ai AFTER INSERT ON session_history BEGIN
      INSERT INTO session_history_fts(rowid, full_text) VALUES (new.rowid, new.full_text);
    END;

    CREATE TRIGGER IF NOT EXISTS session_history_ad AFTER DELETE ON session_history BEGIN
      INSERT INTO session_history_fts(session_history_fts, rowid, full_text)
      VALUES ('delete', old.rowid, old.full_text);
    END;

    CREATE TRIGGER IF NOT EXISTS session_history_au AFTER UPDATE ON session_history BEGIN
      INSERT INTO session_history_fts(session_history_fts, rowid, full_text)
      VALUES ('delete', old.rowid, old.full_text);
      INSERT INTO session_history_fts(rowid, full_text) VALUES (new.rowid, new.full_text);
    END;
  `);
}
