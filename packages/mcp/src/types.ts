/**
 * Types for the Open Hipp0 MCP server.
 *
 * The server is a thin adapter: MCP call → Hipp0 Tool / memory op.
 * Callers construct a ServerDeps and pass it to createMcpServer().
 */

import type { tools as coreTools } from '@openhipp0/core';
import type { db as memoryDb } from '@openhipp0/memory';

type ExecutionContext = coreTools.ExecutionContext;
import type { HealthRegistry } from '@openhipp0/watchdog';
import type { SchedulerEngine } from '@openhipp0/scheduler';

export interface ServerDeps {
  /** Drizzle client for memory operations. Required for any `decision_*` / `memory_*` tool. */
  db?: memoryDb.HipppoDb;
  /** Project id used when tools don't get one explicitly. */
  defaultProjectId?: string;
  /** Execution context applied to the file/web/shell tools. */
  execContext?: Omit<ExecutionContext, 'agent' | 'projectId'>;
  /** Identity applied to tool calls. Defaults to an anonymous "mcp" agent. */
  agent?: { id: string; name: string; role: string };
  /** If provided, the health_check tool runs against this registry. */
  health?: HealthRegistry;
  /** If provided, the cron_* tools operate against this engine. */
  scheduler?: SchedulerEngine;
  /** Skip tool categories (for headless/test servers). */
  exclude?: ReadonlyArray<'filesystem' | 'web' | 'shell' | 'memory' | 'health' | 'scheduler'>;
}

export const MCP_SERVER_NAME = 'hipp0' as const;
export const MCP_SERVER_VERSION = '0.0.0' as const;
