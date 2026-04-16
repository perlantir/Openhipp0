/**
 * createMcpServer — compose an MCP server that exposes ~20 Open Hipp0 tools.
 *
 * Tool inventory (category → tool name):
 *   filesystem : file_read, file_write, file_list
 *   web        : web_fetch
 *   shell      : shell_execute        (opt-in via deps.execContext.sandbox)
 *   memory     : decision_create, decision_get, decision_list, decision_update,
 *                decision_supersede, decision_search_tags, memory_search,
 *                memory_stats, skill_list, session_get_recent
 *   watchdog   : health_check         (if deps.health supplied)
 *   scheduler  : cron_list, cron_add, cron_remove  (if deps.scheduler supplied)
 *   meta       : server_version, agent_list
 *
 * That's 22 guaranteed + 3 optional = up to 25 tools depending on what the
 * host wires up.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { tools as coreTools } from '@openhipp0/core';
import { MCP_SERVER_NAME, MCP_SERVER_VERSION, type ServerDeps } from './types.js';

type ExecutionContext = coreTools.ExecutionContext;
import { registerHipp0Tool } from './tool-adapter.js';
import { registerMemoryTools } from './tools/memory-tools.js';
import { registerMetaTools } from './tools/meta-tools.js';

const DEFAULT_EXEC_CONTEXT: Omit<ExecutionContext, 'agent' | 'projectId'> = {
  sandbox: 'native',
  timeoutMs: 30_000,
  allowedPaths: [],
  allowedDomains: [],
  grantedPermissions: ['fs.read', 'fs.write', 'net.fetch'],
};

export function createMcpServer(deps: ServerDeps = {}): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });
  const excludeSet = new Set(deps.exclude ?? []);
  const agent = deps.agent ?? { id: 'mcp-server', name: 'Hipp0 MCP', role: 'tool-host' };
  const projectId = deps.defaultProjectId ?? 'default';
  const execContext = deps.execContext ?? DEFAULT_EXEC_CONTEXT;

  if (!excludeSet.has('filesystem')) {
    registerHipp0Tool(server, { tool: coreTools.fileReadTool, execContext, agent, projectId });
    registerHipp0Tool(server, { tool: coreTools.fileWriteTool, execContext, agent, projectId });
    registerHipp0Tool(server, { tool: coreTools.fileListTool, execContext, agent, projectId });
  }

  if (!excludeSet.has('web')) {
    registerHipp0Tool(server, { tool: coreTools.webFetchTool, execContext, agent, projectId });
  }

  if (!excludeSet.has('shell')) {
    registerHipp0Tool(server, { tool: coreTools.shellExecuteTool, execContext, agent, projectId });
  }

  if (!excludeSet.has('memory')) {
    registerMemoryTools(server, deps);
  }

  // Meta tools always register. `health_check` / `cron_*` are gated by deps.
  registerMetaTools(server, deps);

  return server;
}

export { MCP_SERVER_NAME, MCP_SERVER_VERSION };
