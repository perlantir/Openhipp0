import {
  AgentRuntime,
  LLMClient,
  ToolRegistry,
  type AgentIdentity,
  type LLMProvider,
  type Message,
  type SessionSummary,
} from '@openhipp0/core';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hipp0MemoryAdapter } from '../../src/adapter/index.js';
import { closeClient, createClient, runMigrations, type HipppoDb } from '../../src/db/index.js';
import {
  memoryEntries,
  projects,
  sessionHistory,
  skills,
  userModels,
} from '../../src/db/schema.js';
import { createDecision, DeterministicEmbeddingProvider } from '../../src/decisions/index.js';

const agent: AgentIdentity = { id: 'agent:lead', name: 'Lead', role: 'lead' };
const embed = new DeterministicEmbeddingProvider(256, 3);

let db: HipppoDb;
let projectId: string;

beforeEach(async () => {
  db = createClient({ databaseUrl: ':memory:' });
  runMigrations(db);
  const [p] = await db.insert(projects).values({ name: 'Proj' }).returning();
  projectId = p!.id;
});

afterEach(() => closeClient(db));

describe('Hipp0MemoryAdapter.compileContext', () => {
  it('returns an empty sections array when nothing is stored', async () => {
    const adapter = new Hipp0MemoryAdapter({ db, embeddingProvider: embed });
    const ctx = await adapter.compileContext({
      agent,
      projectId,
      query: 'anything',
    });
    expect(ctx.sections).toEqual([]);
  });

  it('includes a decisions section when relevant decisions exist', async () => {
    await createDecision(
      db,
      {
        projectId,
        title: 'Use PostgreSQL',
        reasoning: 'Durable, pgvector, open source.',
        madeBy: agent.id,
        confidence: 'high',
        tags: ['database'],
      },
      { embeddingProvider: embed },
    );
    const adapter = new Hipp0MemoryAdapter({ db, embeddingProvider: embed });
    const ctx = await adapter.compileContext({
      agent,
      projectId,
      query: 'Which database for durability?',
    });
    expect(ctx.sections.length).toBeGreaterThan(0);
    expect(ctx.sections.some((s) => s.body.includes('PostgreSQL'))).toBe(true);
  });

  it('includes user model snippet when userId resolves to a model', async () => {
    await db.insert(userModels).values({
      userId: 'u1',
      projectId,
      communicationStyle: 'terse',
      expertiseDomains: ['typescript'],
      riskTolerance: 'high',
    });
    const adapter = new Hipp0MemoryAdapter({ db, embeddingProvider: embed });
    const ctx = await adapter.compileContext({
      agent,
      projectId,
      query: 'hi',
      userId: 'u1',
    });
    const userSection = ctx.sections.find((s) => s.title === 'User Model');
    expect(userSection).toBeDefined();
    expect(userSection!.body).toContain('Style: terse');
  });

  it('includes a recall section when FTS5 finds session matches', async () => {
    await db.insert(sessionHistory).values({
      projectId,
      agentId: agent.id,
      summary: 'debugging database migrations',
      fullText: 'We worked through database migration issues.',
    });
    const adapter = new Hipp0MemoryAdapter({ db, embeddingProvider: embed });
    const ctx = await adapter.compileContext({
      agent,
      projectId,
      query: 'database',
    });
    const recallSection = ctx.sections.find((s) => s.title === 'Past Sessions (recalled)');
    expect(recallSection).toBeDefined();
    expect(recallSection!.body).toContain('debugging database migrations');
  });

  it('enableRecall=false skips the recall section', async () => {
    await db.insert(sessionHistory).values({
      projectId,
      agentId: agent.id,
      summary: 'one',
      fullText: 'database',
    });
    const adapter = new Hipp0MemoryAdapter({ db, embeddingProvider: embed, enableRecall: false });
    const ctx = await adapter.compileContext({ agent, projectId, query: 'database' });
    expect(ctx.sections.find((s) => s.title?.startsWith('Past Sessions'))).toBeUndefined();
  });
});

describe('Hipp0MemoryAdapter.recordSession', () => {
  function makeSession(overrides: Partial<SessionSummary> = {}): SessionSummary {
    const messages: Message[] = Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `turn ${i}`,
    }));
    return {
      agent,
      projectId,
      userId: 'u1',
      messages,
      iterations: 6,
      toolCallsCount: 6,
      tokensUsed: { input: 500, output: 200 },
      finalText: 'Final text summary',
      startedAt: 1,
      finishedAt: 2,
      stoppedReason: 'end_turn',
      ...overrides,
    };
  }

  it('writes a session_history row', async () => {
    const adapter = new Hipp0MemoryAdapter({ db });
    await adapter.recordSession(makeSession());
    const rows = await db
      .select()
      .from(sessionHistory)
      .where(eq(sessionHistory.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.summary).toContain('Final text');
    expect(rows[0]!.toolCallsCount).toBe(6);
  });

  it('creates a skill via skillWriter when tool calls are sufficient', async () => {
    const writer = vi.fn(async () => ({
      title: 'Debug migration',
      contentMd: '---\ntitle: Debug\n---\nSteps…',
    }));
    const adapter = new Hipp0MemoryAdapter({ db, embeddingProvider: embed, skillWriter: writer });
    await adapter.recordSession(makeSession({ toolCallsCount: 6 }));
    expect(writer).toHaveBeenCalledOnce();
    const rows = await db.select().from(skills).where(eq(skills.projectId, projectId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.autoGenerated).toBe(true);
  });

  it('skips skill creation when no skillWriter is configured', async () => {
    const adapter = new Hipp0MemoryAdapter({ db, embeddingProvider: embed });
    await adapter.recordSession(makeSession({ toolCallsCount: 6 }));
    const rows = await db.select().from(skills);
    expect(rows).toHaveLength(0);
  });

  it('nudges memory via factExtractor', async () => {
    const extractor = vi.fn(async () => [
      { content: 'User prefers TypeScript', category: 'preference' as const },
    ]);
    const adapter = new Hipp0MemoryAdapter({ db, factExtractor: extractor });
    await adapter.recordSession(makeSession());
    expect(extractor).toHaveBeenCalledOnce();
    const mems = await db
      .select()
      .from(memoryEntries)
      .where(eq(memoryEntries.projectId, projectId));
    expect(mems).toHaveLength(1);
    expect(mems[0]!.content).toContain('TypeScript');
  });

  it('updates user model via userModelUpdater', async () => {
    const updater = vi.fn(async () => ({
      expertiseDomainsAdd: ['rust'],
      riskTolerance: 'high' as const,
    }));
    const adapter = new Hipp0MemoryAdapter({ db, userModelUpdater: updater });
    await adapter.recordSession(makeSession());
    expect(updater).toHaveBeenCalledOnce();
    const [um] = await db.select().from(userModels).where(eq(userModels.userId, 'u1'));
    expect(um!.expertiseDomains).toEqual(['rust']);
    expect(um!.riskTolerance).toBe('high');
  });

  it('sessionSummarizer does nothing when below threshold', async () => {
    const summarizer = vi.fn(async () => 'summary');
    const adapter = new Hipp0MemoryAdapter({ db, sessionSummarizer: summarizer });
    // short messages → below default threshold
    await adapter.recordSession(makeSession());
    // No compression child row should exist (only the primary session row).
    const rows = await db.select().from(sessionHistory);
    expect(rows.filter((r) => r.lineageParentId !== null)).toHaveLength(0);
  });

  it('side-effect failures do not throw from recordSession', async () => {
    const throwingWriter = vi.fn(async () => {
      throw new Error('writer down');
    });
    const adapter = new Hipp0MemoryAdapter({
      db,
      embeddingProvider: embed,
      skillWriter: throwingWriter,
    });
    await expect(adapter.recordSession(makeSession())).resolves.toBeUndefined();
    // Session row still written.
    const rows = await db.select().from(sessionHistory);
    expect(rows).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end: AgentRuntime + Hipp0MemoryAdapter + mock LLM
// ─────────────────────────────────────────────────────────────────────────────

describe('AgentRuntime + Hipp0MemoryAdapter (integration)', () => {
  function scriptedProvider(text: string): LLMProvider {
    return {
      name: 'scripted',
      model: 'test',
      async chatSync() {
        return {
          content: [{ type: 'text', text }],
          stopReason: 'end_turn',
          usage: { inputTokens: 10, outputTokens: 5 },
          model: 'test',
          provider: 'scripted',
        };
      },
      async *chat() {
        const r = await this.chatSync();
        yield { type: 'message_stop', stopReason: r.stopReason, usage: r.usage };
        return r;
      },
      countTokens: (t: string) => Math.ceil(t.length / 4),
    };
  }

  it('full loop: memory compiles context, records session, user model updates', async () => {
    // Seed one decision so the compiled context is non-empty.
    await createDecision(
      db,
      {
        projectId,
        title: 'Use PostgreSQL',
        reasoning: 'Durable.',
        madeBy: agent.id,
        confidence: 'high',
        tags: ['database'],
      },
      { embeddingProvider: embed },
    );

    const updater = vi.fn(async () => ({ expertiseDomainsAdd: ['databases'] }));
    const adapter = new Hipp0MemoryAdapter({
      db,
      embeddingProvider: embed,
      userModelUpdater: updater,
    });

    const llm = new LLMClient(
      {
        providers: [{ type: 'anthropic', model: 'test' }],
        retry: { maxAttempts: 1, baseDelayMs: 1 },
      },
      {},
      () => scriptedProvider('OK, picked PostgreSQL.'),
    );

    const runtime = new AgentRuntime({
      llmClient: llm,
      toolRegistry: new ToolRegistry(),
      agent,
      projectId,
      executionContext: {
        sandbox: 'native',
        timeoutMs: 5000,
        allowedPaths: [],
        allowedDomains: [],
        grantedPermissions: [],
      },
      memory: adapter,
    });

    const resp = await runtime.handleMessage({
      userId: 'u1',
      message: 'Which database should we use?',
    });

    // Loop completed cleanly.
    expect(resp.stoppedReason).toBe('end_turn');
    expect(resp.text).toContain('PostgreSQL');

    // Memory wrote a session row.
    const sessions = await db.select().from(sessionHistory);
    expect(sessions).toHaveLength(1);

    // User model was updated by the adapter's userModelUpdater hook.
    expect(updater).toHaveBeenCalledOnce();
    const [um] = await db.select().from(userModels).where(eq(userModels.userId, 'u1'));
    expect(um!.expertiseDomains).toEqual(['databases']);
  });
});
