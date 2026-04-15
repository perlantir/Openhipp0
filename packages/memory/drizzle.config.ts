/**
 * drizzle-kit config — generates SQL migrations from src/db/schema.ts.
 *
 * Regenerate after any schema change:
 *   pnpm --filter @openhipp0/memory db:generate
 *
 * Postgres support (Phase 2.x) will add a sibling drizzle.pg.config.ts.
 */

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
});
