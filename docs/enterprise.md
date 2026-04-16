# Enterprise (Phase 14)

Open Hipp0's enterprise module ships five primitives that every multi-tenant
deployment needs: PostgreSQL row-level security, SAML+OIDC SSO with JIT
provisioning, an organization/team model with role hierarchy, audit log
export for SIEM integration, and per-agent API keys.

## 1. Row-Level Security

SQLite deployments are single-tenant by design; Postgres deployments run
with `enable_row_level_security + force_row_level_security` on every
tenant-scoped table. Per-request, call `setSessionContext` before any
query and `resetSessionContext` in your response finalizer.

```ts
import { setSessionContext, resetSessionContext, generateRlsMigrationSql } from '@openhipp0/core';

// At schema setup:
const sql = generateRlsMigrationSql(['decisions', 'skills', 'sessions']);
await postgres.execute(sql);

// Per request:
await setSessionContext(db, { tenantId: req.tenantId, projectId: req.projectId });
try {
  await handler(req, res);
} finally {
  await resetSessionContext(db);
}
```

Policies check `current_setting('app.tenant_id') = row.tenant_id` AND the
same for `project_id`. Rows without those columns are inaccessible.

## 2. SSO

Both SAML 2.0 and OIDC flow through the same user-claims shape. Production
wires `samlify` / `openid-client` as verifiers; tests stub them.

```ts
import { buildOidcAuthorizeUrl, consumeOidcIdToken, jitProvision } from '@openhipp0/core';

app.get('/auth/login', (req, res) => {
  const url = buildOidcAuthorizeUrl(provider, `${APP_URL}/auth/cb`, state, nonce);
  res.redirect(url);
});

app.get('/auth/cb', async (req, res) => {
  const claims = await consumeOidcIdToken(idToken, provider, nonce, verifier);
  const { userId } = await jitProvision(provider, claims, userStore);
  res.session.userId = userId;
});
```

## 3. Organizations + teams

`OrgService` enforces the `owner > admin > member > viewer` hierarchy.
Admins can't promote to owner; the last owner can't be removed.

## 4. Audit log export

Three formats:
- `exportAsJson` (JSONL for Elasticsearch/Datadog)
- `exportAsCsv` (spreadsheet-friendly)
- `exportAsCef` (ArcSight CEF — Splunk, QRadar, Chronicle understand this)

Severity is derived from `event.result`: success=3, failure=6, denied=7.

## 5. Per-agent API keys

Keys are stored as SHA-256 hashes; plaintext is returned exactly once
from `mintApiKey` and `rotateApiKey`. `verifyApiKey` touches `lastUsedAt`
on every valid call, enforces `expiresAt`, and rejects revoked keys.
