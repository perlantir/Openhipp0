// @openhipp0/mcp — Model Context Protocol server exposing Open Hipp0 tools.
//
// Phase 8.2: ~20 tools across filesystem, web, shell, memory, health, scheduler,
// and meta categories. The binary `hipp0-mcp` speaks stdio to MCP clients
// (Claude Desktop, Cursor, Windsurf, Claude Code).

export const packageName = '@openhipp0/mcp' as const;
export const version = '0.0.0' as const;

export { createMcpServer, MCP_SERVER_NAME, MCP_SERVER_VERSION } from './server.js';
export { registerHipp0Tool } from './tool-adapter.js';
export { registerMemoryTools } from './tools/memory-tools.js';
export { registerMetaTools } from './tools/meta-tools.js';
export { startStdioServer } from './stdio.js';
export type { ServerDeps } from './types.js';
