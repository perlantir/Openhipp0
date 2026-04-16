/**
 * Unified Bearer auth for /api/* routes.
 *
 * Accepts two token forms:
 *   1. Static ops token (env `HIPP0_API_TOKEN` / `--api-token`).
 *   2. Per-agent API keys minted via Phase 14 (`hipp0_ak_...`). Resolved
 *      through the optional AgentApiKeyStore so deployments without
 *      enterprise wiring still work.
 *
 * On success the middleware attaches a typed `auth` object to the request
 * for downstream handlers (RLS + per-agent metering, etc). Handlers that
 * don't need it can ignore the attachment — the shape is purely additive.
 */

import type { Route } from '@openhipp0/bridge';

export interface AuthResolution {
  /** 'static' = env token match; 'agent-key' = verified per-agent credential. */
  kind: 'static' | 'agent-key';
  agentId?: string;
  organizationId?: string;
  scopes?: readonly string[];
  /** Key id for auditing / lastUsedAt bumps. */
  keyId?: string;
}

export interface AuthenticatedRequest {
  auth?: AuthResolution;
}

export type AuthMiddleware = (handler: Route['handler']) => Route['handler'];

interface VerifyResult {
  ok: boolean;
  key?: { id: string; agentId: string; organizationId: string; scopes: readonly string[] };
  reason?: string;
}

export interface ApiKeyResolver {
  /** Resolves a plaintext `hipp0_ak_*` token to a verified key record. */
  verify(plaintext: string, now?: Date): Promise<VerifyResult>;
}

export interface BuildApiAuthOptions {
  /** Static ops token. When set + no keyStore, this is the only accepted credential. */
  staticToken?: string;
  /** Optional Phase 14 agent-key resolver. */
  keyStore?: ApiKeyResolver;
}

/**
 * Returns a middleware that wraps a route handler with Bearer auth.
 *
 * Behavior matrix:
 *   - no staticToken + no keyStore → auth disabled (open, dev mode)
 *   - staticToken + no keyStore    → only static token accepted
 *   - no staticToken + keyStore    → only agent keys accepted
 *   - staticToken + keyStore       → either accepted; agent keys take precedence
 */
export function buildApiAuth(opts: BuildApiAuthOptions = {}): AuthMiddleware {
  const { staticToken, keyStore } = opts;
  const authDisabled = !staticToken && !keyStore;

  return (handler) => {
    if (authDisabled) return handler;

    return async (ctx) => {
      const headers = (ctx.req as { headers?: Record<string, string | undefined> }).headers;
      const authHeader = headers?.['authorization'];
      const bearer = extractBearer(authHeader);
      if (!bearer) return { status: 401, body: { error: 'unauthorized', reason: 'no-bearer' } };

      let resolution: AuthResolution | undefined;

      // Try agent-key first — longer, more specific format.
      if (keyStore && bearer.startsWith('hipp0_ak_')) {
        const result = await keyStore.verify(bearer);
        if (result.ok && result.key) {
          resolution = {
            kind: 'agent-key',
            agentId: result.key.agentId,
            organizationId: result.key.organizationId,
            scopes: result.key.scopes,
            keyId: result.key.id,
          };
        } else if (!staticToken) {
          return { status: 401, body: { error: 'unauthorized', reason: result.reason ?? 'invalid-key' } };
        }
      }

      // Fall back (or primary) to static token.
      if (!resolution && staticToken && bearer === staticToken) {
        resolution = { kind: 'static' };
      }

      if (!resolution) return { status: 401, body: { error: 'unauthorized', reason: 'invalid-token' } };

      // Attach to the request so handlers can read it.
      (ctx.req as AuthenticatedRequest).auth = resolution;
      return handler(ctx);
    };
  };
}

function extractBearer(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return undefined;
  return trimmed.slice(7).trim() || undefined;
}
