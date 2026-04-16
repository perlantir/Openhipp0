import { describe, it, expect } from 'vitest';
import {
  packageName,
  version,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  createMcpServer,
  registerHipp0Tool,
  registerMemoryTools,
  registerMetaTools,
  startStdioServer,
} from '../src/index.js';

describe('@openhipp0/mcp smoke', () => {
  it('exports identity and factories', () => {
    expect(packageName).toBe('@openhipp0/mcp');
    expect(version).toBe('0.0.0');
    expect(MCP_SERVER_NAME).toBe('hipp0');
    expect(MCP_SERVER_VERSION).toBe('0.0.0');
    expect(typeof createMcpServer).toBe('function');
    expect(typeof registerHipp0Tool).toBe('function');
    expect(typeof registerMemoryTools).toBe('function');
    expect(typeof registerMetaTools).toBe('function');
    expect(typeof startStdioServer).toBe('function');
  });
});
