/**
 * stdio entrypoint — `hipp0-mcp` binary connects the McpServer to the
 * Claude Desktop / Cursor / Windsurf stdio protocol.
 *
 * Configuration is via environment variables so the MCP client (which
 * spawns this process with no flags) can still customize behavior:
 *
 *   DATABASE_URL          → SQLite / Postgres URL (memory tools)
 *   HIPP0_PROJECT_ID      → default project id (default: "default")
 *   HIPP0_ALLOWED_PATHS   → colon-separated list of fs-write roots (default: empty)
 *   HIPP0_ALLOWED_DOMAINS → comma-separated list of web_fetch hosts (default: empty)
 *   HIPP0_SANDBOX         → "native" | "docker" (default: "native")
 *
 * Memory tools register only when `DATABASE_URL` is set (or points at a
 * discoverable default SQLite file).
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { db as memoryDb } from '@openhipp0/memory';
import type { tools as coreTools } from '@openhipp0/core';
import { createMcpServer } from './server.js';
import type { ServerDeps } from './types.js';

type ExecutionContext = coreTools.ExecutionContext;

export interface StdioEntrypointOptions {
  /** Override process.env for testability. */
  env?: NodeJS.ProcessEnv;
}

export async function startStdioServer(opts: StdioEntrypointOptions = {}): Promise<void> {
  const env = opts.env ?? process.env;

  const allowedPaths = (env['HIPP0_ALLOWED_PATHS'] ?? '')
    .split(':')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowedDomains = (env['HIPP0_ALLOWED_DOMAINS'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const sandbox = (env['HIPP0_SANDBOX'] ?? 'native') as ExecutionContext['sandbox'];

  const deps: ServerDeps = {
    defaultProjectId: env['HIPP0_PROJECT_ID'] ?? 'default',
    execContext: {
      sandbox,
      timeoutMs: 30_000,
      allowedPaths,
      allowedDomains,
      grantedPermissions: ['fs.read', 'fs.write', 'net.fetch'],
    },
  };

  const dbUrl = env['DATABASE_URL'];
  if (dbUrl) {
    const db = memoryDb.createClient({ databaseUrl: dbUrl });
    memoryDb.runMigrations(db);
    deps.db = db;
  }

  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
