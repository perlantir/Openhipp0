import { describe, expect, it, beforeEach } from 'vitest';
import { createClient, runMigrations, type HipppoDb } from '../../src/db/index.js';
import { projects, reflectionEvents } from '../../src/db/schema.js';
import { createReflectionPersist } from '../../src/reflection/persist.js';

describe('createReflectionPersist', () => {
  let db: HipppoDb;
  let persist: ReturnType<typeof createReflectionPersist>;

  beforeEach(async () => {
    db = createClient({ databaseUrl: ':memory:' });
    runMigrations(db);
    await db.insert(projects).values({ id: 'p1', name: 'Probe' });
    persist = createReflectionPersist(db);
  });

  it('inserts a critique event with rubricIssues + llm flags', async () => {
    await persist({
      kind: 'critique',
      projectId: 'p1',
      agentId: 'agent-a',
      turnIndex: 3,
      rubricIssues: ['tool-error-unacknowledged'],
      llmInvoked: true,
      critiqueScore: 0.82,
      accept: false,
      revisionApplied: true,
      reason: 'tool failure was not mentioned',
    });
    const rows = await db.select().from(reflectionEvents);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: 'p1',
      kind: 'critique',
      turnIndex: 3,
      llmInvoked: true,
      accept: false,
      revisionApplied: true,
    });
    expect(rows[0]?.rubricIssues).toEqual(['tool-error-unacknowledged']);
  });

  it('inserts an outcome event with outcomeScore', async () => {
    await persist({
      kind: 'outcome',
      projectId: 'p1',
      agentId: 'agent-a',
      turnIndex: 5,
      rubricIssues: [],
      llmInvoked: true,
      outcomeScore: -0.3,
      reason: 'user repeated the same question',
    });
    const rows = await db.select().from(reflectionEvents);
    expect(rows[0]?.kind).toBe('outcome');
    expect(rows[0]?.outcomeScore).toBeCloseTo(-0.3, 4);
  });

  it('caps the reason field at 2000 chars (no raw dumps)', async () => {
    await persist({
      kind: 'critique',
      projectId: 'p1',
      agentId: 'agent-a',
      turnIndex: 1,
      rubricIssues: [],
      llmInvoked: true,
      reason: 'x'.repeat(5000),
    });
    const rows = await db.select().from(reflectionEvents);
    expect(rows[0]?.reason?.length).toBeLessThanOrEqual(2000);
  });
});
