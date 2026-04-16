#!/usr/bin/env node
// Open Hipp0 MCP stdio entrypoint — spawned by MCP clients.

import { startStdioServer } from '../dist/stdio.js';

startStdioServer().catch((err) => {
  // MCP clients capture stderr; emit a concise line before dying.
  console.error('hipp0-mcp fatal:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
