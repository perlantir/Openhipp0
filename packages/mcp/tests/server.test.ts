/**
 * End-to-end MCP server tests: drive the server with a real MCP Client over
 * an in-memory transport pair. No mocks in the protocol layer.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { db as memoryDb } from '@openhipp0/memory';
import { HealthRegistry } from '@openhipp0/watchdog';
import { SchedulerEngine } from '@openhipp0/scheduler';
import { createMcpServer } from '../src/index.js';

interface Harness {
  client: Client;
  server: McpServer;
  db: memoryDb.HipppoDb;
  scratchDir: string;
  projectId: string;
  teardown(): Promise<void>;
}

async function setup(opts: {
  exclude?: ReadonlyArray<'filesystem' | 'web' | 'shell' | 'memory' | 'health' | 'scheduler'>;
  withHealth?: boolean;
  withScheduler?: boolean;
} = {}): Promise<Harness> {
  const db = memoryDb.createClient({ databaseUrl: ':memory:' });
  memoryDb.runMigrations(db);

  const projectId = 'mcp-test';
  await db.insert(memoryDb.projects).values({ id: projectId, name: 'mcp-test' });

  const scratchDir = mkdtempSync(join(tmpdir(), 'hipp0-mcp-'));

  const server = createMcpServer({
    db,
    defaultProjectId: projectId,
    execContext: {
      sandbox: 'native',
      timeoutMs: 5_000,
      allowedPaths: [scratchDir],
      allowedDomains: ['example.com'],
      grantedPermissions: ['fs.read', 'fs.write', 'net.fetch'],
    },
    ...(opts.withHealth !== false && { health: new HealthRegistry() }),
    ...(opts.withScheduler !== false && { scheduler: new SchedulerEngine() }),
    ...(opts.exclude && { exclude: opts.exclude }),
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    server,
    db,
    scratchDir,
    projectId,
    async teardown() {
      try {
        await client.close();
      } catch {
        /* ignore */
      }
      try {
        await server.close();
      } catch {
        /* ignore */
      }
      try {
        memoryDb.closeClient(db);
      } catch {
        /* ignore */
      }
      try {
        rmSync(scratchDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    },
  };
}

describe('MCP server — protocol surface', () => {
  let h: Harness | undefined;
  afterEach(async () => {
    await h?.teardown();
    h = undefined;
  });

  it('lists at least 20 tools when fully configured', async () => {
    h = await setup();
    const list = await h.client.listTools();
    expect(list.tools.length).toBeGreaterThanOrEqual(20);
    const names = list.tools.map((t) => t.name);
    // Spot-check that each category is represented.
    expect(names).toContain('file_read');
    expect(names).toContain('web_fetch');
    expect(names).toContain('shell_execute');
    expect(names).toContain('decision_create');
    expect(names).toContain('memory_search');
    expect(names).toContain('server_version');
    expect(names).toContain('agent_list');
  });

  it('server_version returns the server identity', async () => {
    h = await setup({ exclude: ['filesystem', 'web', 'shell', 'memory'] });
    const result = await h.client.callTool({ name: 'server_version', arguments: {} });
    const firstBlock = (result.content as Array<{ type: string; text: string }>)[0];
    expect(firstBlock?.type).toBe('text');
    const parsed = JSON.parse(firstBlock!.text) as { name: string; version: string };
    expect(parsed.name).toBe('hipp0');
  });

  it('file_write lands a real file under allowedPaths', async () => {
    h = await setup({ exclude: ['memory'] });
    const target = join(h.scratchDir, 'hello.txt');
    const result = await h.client.callTool({
      name: 'file_write',
      arguments: { path: target, content: 'mcp-wrote-this', encoding: 'utf8' },
    });
    expect(result.isError).not.toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('mcp-wrote-this');
  });

  it('decision_create → decision_list round-trips through SQLite', async () => {
    h = await setup({ exclude: ['filesystem', 'web', 'shell'] });

    const createResp = await h.client.callTool({
      name: 'decision_create',
      arguments: {
        title: 'Use MCP for external tools',
        reasoning: 'Standard protocol; many clients already speak it.',
        madeBy: 'test-user',
        confidence: 'high',
        tags: ['architecture', 'tools'],
      },
    });
    const createBlock = (createResp.content as Array<{ text: string }>)[0]!;
    const created = JSON.parse(createBlock.text) as { id: string };
    expect(created.id).toBeTruthy();

    const listResp = await h.client.callTool({
      name: 'decision_list',
      arguments: { limit: 10 },
    });
    const listBlock = (listResp.content as Array<{ text: string }>)[0]!;
    const rows = JSON.parse(listBlock.text) as Array<{ id: string; title: string }>;
    expect(rows.some((r) => r.id === created.id)).toBe(true);
  });

  it('memory_stats returns zeros on an empty DB', async () => {
    h = await setup({ exclude: ['filesystem', 'web', 'shell'] });
    const resp = await h.client.callTool({ name: 'memory_stats', arguments: {} });
    const block = (resp.content as Array<{ text: string }>)[0]!;
    const stats = JSON.parse(block.text) as Record<string, number>;
    expect(stats['decisions']).toBe(0);
    expect(stats['sessionHistory']).toBe(0);
  });

  it('file_read reports HIPP0-style errors as isError:true results', async () => {
    h = await setup({ exclude: ['memory'] });
    const resp = await h.client.callTool({
      name: 'file_read',
      arguments: { path: '/etc/shadow' }, // outside allowedPaths
    });
    expect(resp.isError).toBe(true);
    const block = (resp.content as Array<{ text: string }>)[0]!;
    expect(block.text).toMatch(/HIPP0_PATH_DENIED|path|denied/i);
  });
});
