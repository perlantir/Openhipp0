/**
 * Public surface of @openhipp0/memory/db.
 * Re-exports schema tables, types, client factory, and migration runner.
 */

export * from './schema.js';
export {
  createClient,
  closeClient,
  resolveSqlitePath,
  Hipp0NotImplementedError,
  type HipppoDb,
  type ClientOptions,
} from './client.js';
export { runMigrations, createFtsVirtualTable, defaultMigrationsFolder } from './migrate.js';
