/**
 * Multi-tenant row-level security primitives.
 *
 * Open Hipp0 ships a Postgres RLS policy set that mechanically isolates
 * rows by `tenant_id` and `project_id`. Every per-request database
 * connection must call `setSessionContext(db, { tenantId, projectId })`
 * BEFORE executing any query; on request completion or failure, call
 * `resetSessionContext(db)` to prevent context bleed between requests.
 *
 * The SQL is emitted here rather than embedded in migrations so that
 * operators can review + apply it via their regular schema migration
 * pipeline. SQLite (local dev) does not support RLS — we skip it there
 * and rely on process-level isolation.
 */

export const RLS_SESSION_VARS = {
  tenant: 'app.tenant_id',
  project: 'app.project_id',
  user: 'app.user_id',
  role: 'app.role',
} as const;

export interface RlsContext {
  tenantId: string;
  projectId: string;
  userId?: string;
  role?: 'owner' | 'admin' | 'member' | 'viewer';
}

/**
 * An abstract DB handle so the functions below don't depend on Drizzle or
 * pg specifically. `execute` runs raw SQL with a single positional array.
 */
export interface RlsDb {
  execute(sql: string, params?: readonly unknown[]): Promise<unknown>;
}

/** Per-request: call before any query. */
export async function setSessionContext(db: RlsDb, ctx: RlsContext): Promise<void> {
  await db.execute(`SELECT set_config($1, $2, true)`, [RLS_SESSION_VARS.tenant, ctx.tenantId]);
  await db.execute(`SELECT set_config($1, $2, true)`, [RLS_SESSION_VARS.project, ctx.projectId]);
  if (ctx.userId !== undefined) {
    await db.execute(`SELECT set_config($1, $2, true)`, [RLS_SESSION_VARS.user, ctx.userId]);
  }
  if (ctx.role !== undefined) {
    await db.execute(`SELECT set_config($1, $2, true)`, [RLS_SESSION_VARS.role, ctx.role]);
  }
}

/** Per-request: call after response is flushed / error handled. */
export async function resetSessionContext(db: RlsDb): Promise<void> {
  for (const key of Object.values(RLS_SESSION_VARS)) {
    await db.execute(`SELECT set_config($1, $2, true)`, [key, '']);
  }
}

/**
 * Enable RLS + install policies for a table. The policies key rows by the
 * table's `tenant_id` and `project_id` columns; rows without those columns
 * are not readable by any request. Operators who want to expose an
 * organization-scoped row to all projects can add a secondary policy manually.
 */
export function enableRlsSql(table: string): string[] {
  return [
    `ALTER TABLE ${quoteIdent(table)} ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ${quoteIdent(table)} FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS ${policyName(table, 'tenant')} ON ${quoteIdent(table)};`,
    `CREATE POLICY ${policyName(table, 'tenant')} ON ${quoteIdent(table)}
       USING (tenant_id::text = current_setting('${RLS_SESSION_VARS.tenant}', true))
       WITH CHECK (tenant_id::text = current_setting('${RLS_SESSION_VARS.tenant}', true));`,
    `DROP POLICY IF EXISTS ${policyName(table, 'project')} ON ${quoteIdent(table)};`,
    `CREATE POLICY ${policyName(table, 'project')} ON ${quoteIdent(table)}
       USING (project_id::text = current_setting('${RLS_SESSION_VARS.project}', true))
       WITH CHECK (project_id::text = current_setting('${RLS_SESSION_VARS.project}', true));`,
  ];
}

/** Disable RLS on a table (test cleanup / admin override). */
export function disableRlsSql(table: string): string[] {
  return [
    `DROP POLICY IF EXISTS ${policyName(table, 'tenant')} ON ${quoteIdent(table)};`,
    `DROP POLICY IF EXISTS ${policyName(table, 'project')} ON ${quoteIdent(table)};`,
    `ALTER TABLE ${quoteIdent(table)} DISABLE ROW LEVEL SECURITY;`,
  ];
}

/**
 * Migration helper: takes the list of tables the app stores project data in
 * (decisions, skills, memory_entries, sessions, etc.) and returns the full
 * set of SQL statements to run. Operators apply these alongside their normal
 * Drizzle migrations.
 */
export function generateRlsMigrationSql(tables: readonly string[]): string {
  return tables.flatMap(enableRlsSql).join('\n');
}

/**
 * Document the SQLite → Postgres migration path. Returned as a plain string
 * so it can be dropped into docs/ or printed by `hipp0 doctor`.
 */
export function sqliteToPostgresMigrationGuide(): string {
  return [
    'Open Hipp0 ships single-tenant on SQLite and multi-tenant on Postgres. To migrate:',
    '',
    '  1. Dump the SQLite DB via `hipp0 migrate dump ./hipp0-export.sql`.',
    '  2. Provision Postgres 17 + pgvector; create an empty database.',
    '  3. Set DATABASE_URL=postgres://... and run `pnpm -r drizzle:migrate` to create tables.',
    '  4. Run the RLS migration emitted by `generateRlsMigrationSql(APP_TABLES)`.',
    '  5. Transform the export with `scripts/sqlite-to-postgres.mjs` (adds tenant_id + project_id columns).',
    '  6. Load the transformed dump: psql $DATABASE_URL < hipp0-export.postgres.sql.',
    '  7. Verify with `hipp0 doctor` — the tenant-isolation check runs two bogus queries and expects both to return zero rows.',
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────

function quoteIdent(ident: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ident)) {
    throw new Error(`Unsafe identifier: ${ident}`);
  }
  return `"${ident}"`;
}

function policyName(table: string, suffix: string): string {
  return `p_${table}_${suffix}`;
}
