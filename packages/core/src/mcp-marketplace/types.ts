/**
 * MCP server marketplace types.
 *
 * An MCP bundle is a signed JSON envelope describing how to launch a
 * community MCP server + the posture (tools/domains/paths/env) the install
 * will expose. Bundles are content-addressable (SHA-256) + optionally
 * publisher-signed (Ed25519) so operators can audit and verify before
 * accepting code from a third party.
 */

import { z } from 'zod';

export const McpServerCommandSchema = z.object({
  cmd: z.string().min(1).max(256),
  args: z.array(z.string().max(1000)).default([]),
  env: z.record(z.string().max(1000)).default({}),
});
export type McpServerCommand = z.infer<typeof McpServerCommandSchema>;

export const McpPostureSchema = z.object({
  /** Tool names this server will expose. Used for namespace-collision check. */
  tools: z.array(z.string().min(1).max(128)).default([]),
  /** Network domains the server may reach at runtime. Default localhost-only. */
  networkAllowlist: z.array(z.string().max(256)).default(['localhost']),
  /** FS paths (absolute or ~/) the server may read/write. */
  fsPaths: z.array(z.string().max(512)).default([]),
  /** Env var names the server reads. Values are NEVER in the bundle. */
  envVarsRead: z.array(z.string().max(128)).default([]),
  /** Short human description of what the server does. */
  description: z.string().max(2000).default(''),
});
export type McpPosture = z.infer<typeof McpPostureSchema>;

export const McpServerBundleSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be kebab-case'),
  version: z.string().min(1).max(64),
  command: McpServerCommandSchema,
  posture: McpPostureSchema,
  /** Optional Ed25519 detached signature over the canonical contentHash. */
  signature: z
    .object({
      algorithm: z.literal('ed25519'),
      /** base64-encoded public key. */
      publicKey: z.string().min(1).max(1024),
      /** base64-encoded signature. */
      signature: z.string().min(1).max(1024),
      signer: z.string().max(256).optional(),
    })
    .optional(),
  publishedAt: z.string().default(''),
  /** SHA-256 hex of the canonical bundle serialization (name + version + command + posture). */
  contentHash: z.string().length(64),
});
export type McpServerBundle = z.infer<typeof McpServerBundleSchema>;

/**
 * Result of a diff between the currently-installed state (if any) and an
 * incoming bundle — shown to the operator BEFORE install so they can see
 * what changed.
 */
export interface PostureDiff {
  readonly toolsAdded: readonly string[];
  readonly toolsRemoved: readonly string[];
  readonly networkAdded: readonly string[];
  readonly networkRemoved: readonly string[];
  readonly fsPathsAdded: readonly string[];
  readonly fsPathsRemoved: readonly string[];
  readonly envVarsAdded: readonly string[];
  readonly commandChanged: boolean;
  readonly signatureState: 'unchanged' | 'added' | 'removed' | 'rotated' | 'unsigned';
}

export interface InstalledMcpRecord {
  readonly name: string;
  readonly version: string;
  readonly contentHash: string;
  readonly previousContentHash?: string;
  readonly installedAt: string;
  readonly updatedAt: string;
  readonly pinned: boolean;
  readonly enabled: boolean;
  readonly signer?: string;
}

export interface MarketplaceLedger {
  readonly installed: readonly InstalledMcpRecord[];
}
