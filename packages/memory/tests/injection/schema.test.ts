import { beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createClient, runMigrations, type HipppoDb } from '../../src/db/index.js';
import { memoryEntries, projects, sessionHistory } from '../../src/db/schema.js';
import { maybeNudge } from '../../src/learning/nudge.js';

describe('memory_entries + session_history trust/origin columns (Follow-up C)', () => {
  let db: HipppoDb;

  beforeEach(async () => {
    db = createClient({ databaseUrl: ':memory:' });
    runMigrations(db);
    await db.insert(projects).values({ id: 'p1', name: 'p1' }).onConflictDoNothing();
  });

  it('memory_entries accepts an insert carrying origin + trust', async () => {
    await db.insert(memoryEntries).values({
      projectId: 'p1',
      agentId: 'a1',
      content: 'user prefers Redis over Memcached',
      category: 'preference',
      origin: 'user',
      trust: 'high',
    });
    const rows = await db.select().from(memoryEntries).where(eq(memoryEntries.projectId, 'p1'));
    expect(rows[0]?.origin).toBe('user');
    expect(rows[0]?.trust).toBe('high');
  });

  it('memory_entries accepts null trust/origin (back-compat)', async () => {
    await db.insert(memoryEntries).values({
      projectId: 'p1',
      agentId: 'a1',
      content: 'legacy entry',
    });
    const rows = await db.select().from(memoryEntries).where(eq(memoryEntries.projectId, 'p1'));
    expect(rows[0]?.origin).toBeNull();
    expect(rows[0]?.trust).toBeNull();
  });

  it('session_history accepts an insert carrying origin + trust', async () => {
    await db.insert(sessionHistory).values({
      projectId: 'p1',
      agentId: 'a1',
      summary: 's',
      fullText: 't',
      origin: 'memory',
      trust: 'medium',
    });
    const rows = await db.select().from(sessionHistory).where(eq(sessionHistory.projectId, 'p1'));
    expect(rows[0]?.trust).toBe('medium');
  });

  it('memory_entries trust index is usable (filter by trust=untrusted)', async () => {
    await db.insert(memoryEntries).values({
      projectId: 'p1',
      agentId: 'a',
      content: 'spam from public channel',
      origin: 'connector',
      trust: 'untrusted',
    });
    await db.insert(memoryEntries).values({
      projectId: 'p1',
      agentId: 'a',
      content: 'trusted note',
      origin: 'user',
      trust: 'high',
    });
    const quarantined = await db
      .select()
      .from(memoryEntries)
      .where(and(eq(memoryEntries.projectId, 'p1'), eq(memoryEntries.trust, 'untrusted')));
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.content).toMatch(/spam/);
  });

  it('maybeNudge persists draft.origin + draft.trust onto the row', async () => {
    const result = await maybeNudge(
      db,
      { projectId: 'p1', agentId: 'a', turns: 10, text: 'conversation' },
      async () => [
        {
          content: 'user asked for markdown output',
          category: 'preference',
          origin: 'user',
          trust: 'medium',
        },
      ],
    );
    expect(result.stored).toHaveLength(1);
    expect(result.stored[0]?.origin).toBe('user');
    expect(result.stored[0]?.trust).toBe('medium');
  });
});
