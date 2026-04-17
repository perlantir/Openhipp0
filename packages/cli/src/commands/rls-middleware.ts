/**
 * RLS session-context middleware. Runs after `api-auth` so it can read
 * `req.auth` (organizationId → tenantId).
 *
 * Applies `setSessionContext(db, { tenantId, projectId })` before the
 * handler and `resetSessionContext(db)` afterwards, so Postgres RLS
 * policies mechanically isolate every query to the caller's tenant.
 *
 * Scope:
 *   - No-op when `db` is absent (SQLite deployments — single-tenant by
 *     design, RLS is Postgres-only).
 *   - No-op when the caller authed via the static ops token (no tenant
 *     identity to set). Ops calls are implicitly superuser-equivalent;
 *     audit events annotate them.
 *   - Resets context in a finally block so partial handler failures
 *     can't leak session vars to the next request on the same connection.
 *
 * projectId resolution:
 *   1. `X-Hipp0-Project-Id` header, if present and non-empty.
 *   2. `defaultProjectId` from the middleware config.
 *   3. Falls back to tenantId (single-project per-tenant install).
 */

import type { Route } from '@openhipp0/bridge';
import type { AuthMiddleware, AuthResolution } from './api-auth.js';

export interface RlsDb {
  execute(sql: string, params?: readonly unknown[]): Promise<unknown>;
}

export interface BuildRlsOptions {
  /** Called once per request to obtain the DB handle. Return null for SQLite. */
  getDb: () => Promise<RlsDb | null> | RlsDb | null;
  /** Fallback project id when the caller doesn't send X-Hipp0-Project-Id. */
  defaultProjectId?: string;
  /**
   * When true (default), agent-key callers on an RLS-incapable deployment
   * (SQLite: `getDb()` returns null) are rejected with 500 instead of
   * silently flowing through with no isolation. Flip to false only for
   * single-tenant SQLite deploys where ops knows the agent-key is trusted.
   */
  rejectAgentKeyWithoutRls?: boolean;
}

export function buildRlsMiddleware(opts: BuildRlsOptions): AuthMiddleware {
  const rejectAgentKeyWithoutRls = opts.rejectAgentKeyWithoutRls ?? true;
  return (handler) =>
    async (ctx) => {
      const auth = (ctx.req as { auth?: AuthResolution }).auth;
      // Only agent-key callers get RLS; static (ops) callers bypass.
      if (!auth || auth.kind !== 'agent-key' || !auth.organizationId) {
        return handler(ctx);
      }
      const db = await opts.getDb();
      if (!db) {
        // N7 fix: silent no-op would expose an agent key to the whole DB
        // on SQLite. Fail closed by default.
        if (rejectAgentKeyWithoutRls) {
          return {
            status: 500,
            body: {
              error: 'multi-tenant isolation unavailable on this deployment',
            },
          };
        }
        return handler(ctx);
      }

      const headers = (ctx.req as { headers?: Record<string, string | undefined> }).headers ?? {};
      const projectHeader = headers['x-hipp0-project-id'];
      const projectId =
        (projectHeader && projectHeader.trim()) || opts.defaultProjectId || auth.organizationId;

      try {
        await setSessionVars(db, {
          tenant: auth.organizationId,
          project: projectId,
          ...(auth.agentId && { user: auth.agentId }),
        });
        return await handler(ctx);
      } finally {
        // Reset even on handler throw to prevent context bleed.
        await resetSessionVars(db).catch(() => undefined);
      }
    };
}

async function setSessionVars(
  db: RlsDb,
  vars: { tenant: string; project: string; user?: string },
): Promise<void> {
  await db.execute(`SELECT set_config($1, $2, true)`, ['app.tenant_id', vars.tenant]);
  await db.execute(`SELECT set_config($1, $2, true)`, ['app.project_id', vars.project]);
  if (vars.user) {
    await db.execute(`SELECT set_config($1, $2, true)`, ['app.user_id', vars.user]);
  }
}

async function resetSessionVars(db: RlsDb): Promise<void> {
  for (const key of ['app.tenant_id', 'app.project_id', 'app.user_id', 'app.role']) {
    await db.execute(`SELECT set_config($1, $2, true)`, [key, '']);
  }
}

/**
 * Helper: stack two AuthMiddlewares so a route is wrapped by both in order.
 * `outer` runs first (outer auth → inner rls → handler).
 */
export function chainMiddleware(outer: AuthMiddleware, inner: AuthMiddleware): AuthMiddleware {
  return (handler: Route['handler']) => outer(inner(handler));
}
