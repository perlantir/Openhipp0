import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeClient, createClient, runMigrations, type HipppoDb } from '../../src/db/index.js';
import { projects, sessionHistory, type NewSessionHistory } from '../../src/db/schema.js';
import {
  escapeFts5,
  listRecentSessions,
  naiveSessionSummarizer,
  searchSessions,
  summarizeRecallHits,
} from '../../src/recall/index.js';

let db: HipppoDb;
let projectId: string;

beforeEach(async () => {
  db = createClient({ databaseUrl: ':memory:' });
  runMigrations(db);
  const [p] = await db.insert(projects).values({ name: 'T' }).returning();
  projectId = p!.id;
});
afterEach(() => closeClient(db));

async function seed(
  rows: Array<Partial<NewSessionHistory> & { summary: string; fullText: string }>,
): Promise<void> {
  for (const r of rows) {
    await db.insert(sessionHistory).values({
      projectId,
      agentId: r.agentId ?? 'a1',
      ...(r.userId && { userId: r.userId }),
      summary: r.summary,
      fullText: r.fullText,
    });
  }
}

describe('searchSessions', () => {
  it('finds sessions whose full_text matches the query', async () => {
    await seed([
      {
        summary: 'db debugging',
        fullText: 'We traced a flaky migration test to a missing FTS5 trigger.',
      },
      { summary: 'dashboard', fullText: 'Built a React 19 dashboard with Tailwind.' },
      { summary: 'lunch', fullText: 'Team prefers sandwiches on Mondays.' },
    ]);

    const hits = searchSessions(db, projectId, 'trigger');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.session.summary).toBe('db debugging');
  });

  it('honors agentId filter', async () => {
    await seed([
      { agentId: 'a1', summary: 'one', fullText: 'trigger in agent one' },
      { agentId: 'a2', summary: 'two', fullText: 'trigger in agent two' },
    ]);
    const hits = searchSessions(db, projectId, 'trigger', { agentId: 'a1' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.session.agentId).toBe('a1');
  });

  it('honors userId filter', async () => {
    await seed([
      { userId: 'u1', summary: 'one', fullText: 'database note' },
      { userId: 'u2', summary: 'two', fullText: 'database note' },
    ]);
    const hits = searchSessions(db, projectId, 'database', { userId: 'u1' });
    expect(hits).toHaveLength(1);
    expect(hits[0]!.session.userId).toBe('u1');
  });

  it('returns [] for empty query', () => {
    expect(searchSessions(db, projectId, '')).toEqual([]);
    expect(searchSessions(db, projectId, '   ')).toEqual([]);
  });

  it('returns [] when no matches', async () => {
    await seed([{ summary: 'x', fullText: 'nothing special' }]);
    expect(searchSessions(db, projectId, 'zzz_no_match')).toEqual([]);
  });

  it('respects limit', async () => {
    await seed(
      Array.from({ length: 5 }, (_, i) => ({
        summary: `s${i}`,
        fullText: 'trigger ' + i,
      })),
    );
    expect(searchSessions(db, projectId, 'trigger', { limit: 2 })).toHaveLength(2);
  });

  it('orders hits by FTS5 rank (best first)', async () => {
    await seed([
      { summary: 'weak', fullText: 'trigger once' },
      { summary: 'strong', fullText: 'trigger trigger trigger' },
    ]);
    const hits = searchSessions(db, projectId, 'trigger');
    expect(hits[0]!.session.summary).toBe('strong');
  });
});

describe('escapeFts5', () => {
  it('wraps in double-quotes and escapes embedded quotes', () => {
    expect(escapeFts5('simple')).toBe('"simple"');
    expect(escapeFts5('he said "hi"')).toBe('"he said ""hi"""');
  });

  it('produces a MATCH expression that works with phrase lookups', async () => {
    await seed([
      { summary: 'q1', fullText: 'I said "hello world" last year.' },
      { summary: 'q2', fullText: 'Completely unrelated text.' },
    ]);
    const q = escapeFts5('hello world');
    const hits = searchSessions(db, projectId, q);
    expect(hits).toHaveLength(1);
    expect(hits[0]!.session.summary).toBe('q1');
  });
});

describe('listRecentSessions', () => {
  it('returns sessions scoped to project (+ optional agent/user)', async () => {
    await seed([
      { agentId: 'a1', summary: 'one', fullText: 'x' },
      { agentId: 'a2', summary: 'two', fullText: 'y' },
    ]);
    const all = await listRecentSessions(db, projectId);
    expect(all).toHaveLength(2);
    const forA1 = await listRecentSessions(db, projectId, { agentId: 'a1' });
    expect(forA1).toHaveLength(1);
    expect(forA1[0]!.agentId).toBe('a1');
  });
});

describe('summarizeRecallHits + naiveSessionSummarizer', () => {
  it('joins summaries line-by-line', async () => {
    await seed([
      { summary: 'first', fullText: 'token' },
      { summary: 'second', fullText: 'token' },
    ]);
    const hits = searchSessions(db, projectId, 'token');
    const out = await summarizeRecallHits(hits, naiveSessionSummarizer);
    expect(out).toBeDefined();
    expect(out).toContain('- first');
    expect(out).toContain('- second');
  });

  it('returns null for empty hits', async () => {
    expect(await summarizeRecallHits([], naiveSessionSummarizer)).toBeNull();
  });
});
