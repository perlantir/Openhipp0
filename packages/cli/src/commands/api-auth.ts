/**
 * Unified Bearer auth for /api/* routes.
 *
 * Accepts two token forms:
 *   1. Static ops token (env `HIPP0_API_TOKEN` / `--api-token`).
 *   2. Per-agent API keys minted via Phase 14 (`hipp0_ak_...`). Resolved
 *      through the optional AgentApiKeyStore so deployments without
 *      enterprise wiring still work.
 *
 * Hardening (Phase 3-H1):
 *   - Static-token comparison uses `crypto.timingSafeEqual` (constant-time).
 *   - Failed-auth responses collapse to `{ error: 'unauthorized' }` — no
 *     `reason` field leaks the distinguisher (revoked vs expired vs no-bearer
 *     vs not-found), removing the credential-enumeration oracle.
 *   - Failed auth optionally pushed through `onAuthFailure` for centralised
 *     audit logging (IP + key prefix, NEVER the full token).
 */

import { createHash, timingSafeEqual } from 'node:crypto';
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

/**
 * Optional audit hook. Called on every auth rejection with minimal, safe
 * metadata — never the raw bearer. `keyPrefix` is the first 8 chars of the
 * presented token for correlation; `internalReason` is kept server-side and
 * NEVER surfaced to the client (prevents enumeration).
 */
export type AuthFailureHook = (evt: {
  ip: string;
  keyPrefix: string | undefined;
  internalReason: 'no-bearer' | 'invalid-key' | 'invalid-token' | 'not-bearer';
}) => void | Promise<void>;

export interface BuildApiAuthOptions {
  /** Static ops token. When set + no keyStore, this is the only accepted credential. */
  staticToken?: string;
  /** Optional Phase 14 agent-key resolver. */
  keyStore?: ApiKeyResolver;
  /** Optional audit hook called on every 401. */
  onAuthFailure?: AuthFailureHook;
}

/** Generic unauthorized body — no enumeration oracle. */
const UNAUTHORIZED_BODY = { error: 'unauthorized' } as const;

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
  const { staticToken, keyStore, onAuthFailure } = opts;
  const authDisabled = !staticToken && !keyStore;
  const staticTokenHash = staticToken ? sha256(staticToken) : undefined;

  return (handler) => {
    if (authDisabled) return handler;

    return async (ctx) => {
      const req = ctx.req as { headers?: Record<string, string | undefined>; socket?: { remoteAddress?: string } };
      const headers = req.headers;
      const authHeader = headers?.['authorization'];
      const ip = req.socket?.remoteAddress ?? 'unknown';

      const { bearer, notBearer } = extractBearer(authHeader);
      if (!bearer) {
        await safeHookCall(onAuthFailure, { ip, keyPrefix: undefined, internalReason: notBearer ? 'not-bearer' : 'no-bearer' });
        return { status: 401, body: UNAUTHORIZED_BODY };
      }

      const keyPrefix = bearer.slice(0, 8);
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
          await safeHookCall(onAuthFailure, { ip, keyPrefix, internalReason: 'invalid-key' });
          return { status: 401, body: UNAUTHORIZED_BODY };
        }
      }

      // Fall back (or primary) to static token — constant-time compare.
      if (!resolution && staticTokenHash && constantTimeTokenMatch(bearer, staticTokenHash)) {
        resolution = { kind: 'static' };
      }

      if (!resolution) {
        await safeHookCall(onAuthFailure, { ip, keyPrefix, internalReason: 'invalid-token' });
        return { status: 401, body: UNAUTHORIZED_BODY };
      }

      (ctx.req as AuthenticatedRequest).auth = resolution;
      return handler(ctx);
    };
  };
}

/**
 * Compare a presented token against a pre-hashed reference using
 * `timingSafeEqual`. Comparing SHA-256 digests guarantees equal-length
 * buffers (so `timingSafeEqual` can't leak via length checks either).
 */
function constantTimeTokenMatch(presented: string, referenceHashHex: string): boolean {
  const presentedHash = sha256(presented);
  const a = Buffer.from(presentedHash, 'hex');
  const b = Buffer.from(referenceHashHex, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

function extractBearer(header: string | undefined): { bearer?: string; notBearer: boolean } {
  if (!header) return { notBearer: false };
  const trimmed = header.trim();
  if (!trimmed.toLowerCase().startsWith('bearer ')) return { notBearer: true };
  const tok = trimmed.slice(7).trim();
  return { bearer: tok || undefined, notBearer: false };
}

async function safeHookCall(
  hook: AuthFailureHook | undefined,
  evt: Parameters<AuthFailureHook>[0],
): Promise<void> {
  if (!hook) return;
  try {
    await hook(evt);
  } catch {
    // Audit failures must never gate the 401 response.
  }
}
