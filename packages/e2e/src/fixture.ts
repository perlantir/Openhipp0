/**
 * createFullStack() — wires core + memory + bridge into a live stack backed
 * by an in-memory SQLite database and a scripted LLM. Returns handles for
 * the test to drive and assert against.
 *
 * This is what "end-to-end" means in this repo: no mocks between the Web
 * bridge → Gateway → AgentRuntime → LLMClient → ToolRegistry → MemoryAdapter
 * → Drizzle → better-sqlite3. Only the LLM provider itself is scripted, so
 * we don't hit an external API during CI.
 */

import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  AgentRuntime,
  LLMClient,
  ToolRegistry,
  tools as coreTools,
  type AgentIdentity,
  type AgentRuntimeConfig,
} from '@openhipp0/core';
import { Gateway, WebBridge } from '@openhipp0/bridge';
import { db as memoryDb, adapter as memoryAdapter } from '@openhipp0/memory';
import { FakeLLMProvider, type LLMScriptStep } from './fake-llm.js';

export interface FullStackOptions {
  /** Scripted LLM responses. Agent ends when script is exhausted. */
  script?: readonly LLMScriptStep[];
  /** Agent identity. Default: { id: 'e2e-agent', name: 'E2E', role: 'tester' }. */
  agent?: AgentIdentity;
  /** Project id used for session / decision attribution. Default: 'e2e-proj'. */
  projectId?: string;
  /** Extra paths the tools may touch. A temp dir is always pre-allowed. */
  extraAllowedPaths?: readonly string[];
  /** Random-port WS bridge host. Default: 127.0.0.1. */
  host?: string;
}

export interface FullStack {
  readonly db: memoryDb.HipppoDb;
  readonly llm: FakeLLMProvider;
  readonly toolRegistry: ToolRegistry;
  readonly runtime: AgentRuntime;
  readonly gateway: Gateway;
  readonly web: WebBridge;
  /** URL the test can open a WebSocket against. */
  readonly wsUrl: string;
  /** Temp scratch dir pre-allowed for file_read/file_write. */
  readonly scratchDir: string;
  readonly projectId: string;
  readonly agent: AgentIdentity;
  /** Close the server, DB, and remove the scratch dir. Idempotent. */
  teardown(): Promise<void>;
}

export async function createFullStack(opts: FullStackOptions = {}): Promise<FullStack> {
  const projectId = opts.projectId ?? 'e2e-proj';
  const agent: AgentIdentity = opts.agent ?? { id: 'e2e-agent', name: 'E2E', role: 'tester' };
  const host = opts.host ?? '127.0.0.1';
  const scratchDir = mkdtempSync(join(tmpdir(), 'hipp0-e2e-'));

  // 1. DB — in-memory SQLite, fully migrated (tables + FTS5).
  const db = memoryDb.createClient({ databaseUrl: ':memory:' });
  memoryDb.runMigrations(db);

  // Seed the project row so decision / session writes satisfy their FK.
  await db.insert(memoryDb.projects).values({ id: projectId, name: `e2e-${projectId}` });

  // 2. Tool registry with filesystem built-ins. Shell is omitted here — a
  //    test that needs it can `toolRegistry.register(coreTools.shellExecuteTool)`.
  const toolRegistry = new ToolRegistry();
  toolRegistry.register(coreTools.fileReadTool);
  toolRegistry.register(coreTools.fileWriteTool);

  // 3. LLM — scripted provider behind the real LLMClient (retry + breaker active).
  const llm = new FakeLLMProvider(opts.script ?? []);
  const llmClient = new LLMClient(
    {
      providers: [{ type: 'anthropic', model: llm.model }],
      retry: { maxAttempts: 1, baseDelayMs: 1 },
    },
    {},
    () => llm,
  );

  // 4. Memory adapter — compileContext + recordSession wired through real code.
  const memory = memoryAdapter.createHipp0MemoryAdapter({ db });

  // 5. Agent runtime.
  const runtimeConfig: AgentRuntimeConfig = {
    llmClient,
    toolRegistry,
    agent,
    projectId,
    memory,
    executionContext: {
      sandbox: 'native',
      timeoutMs: 5_000,
      allowedPaths: [scratchDir, ...(opts.extraAllowedPaths ?? [])],
      allowedDomains: [],
      grantedPermissions: ['fs.read', 'fs.write'],
    },
    maxIterations: 10,
  };
  const runtime = new AgentRuntime(runtimeConfig);

  // 6. Web bridge on an ephemeral port.
  const web = new WebBridge({ host, port: 0 });
  const gateway = new Gateway({ bridges: [web], agent: runtime });
  await gateway.start();

  // Ask the underlying HTTP server what port it ended up on. WebBridge
  // doesn't expose this publicly, so we reach through the private field.
  const maybeAddr = (web as unknown as { httpServer?: { address(): unknown } }).httpServer
    ?.address?.();
  const port =
    typeof maybeAddr === 'object' && maybeAddr !== null && 'port' in maybeAddr
      ? Number((maybeAddr as { port: number }).port)
      : 0;
  if (!port) throw new Error('E2E fixture: failed to resolve Web bridge port');
  const wsUrl = `ws://${host}:${port}/ws`;

  let tornDown = false;
  async function teardown(): Promise<void> {
    if (tornDown) return;
    tornDown = true;
    try {
      await gateway.stop();
    } catch {
      /* best effort */
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
  }

  return {
    db,
    llm,
    toolRegistry,
    runtime,
    gateway,
    web,
    wsUrl,
    scratchDir,
    projectId,
    agent,
    teardown,
  };
}
