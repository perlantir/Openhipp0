import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeClient,
  createClient,
  decisionEdges,
  decisions,
  Hipp0NotImplementedError,
  projects,
  resolveSqlitePath,
  runMigrations,
  sessionHistory,
  type HipppoDb,
} from '../src/db/index.js';

describe('db: resolveSqlitePath', () => {
  it('returns ~/.hipp0/hipp0.db by default', () => {
    const path = resolveSqlitePath();
    expect(path).toMatch(/\.hipp0\/hipp0\.db$/);
  });

  it('honors explicit sqlitePath', () => {
    const path = resolveSqlitePath({ sqlitePath: '/tmp/custom.db' });
    expect(path).toBe('/tmp/custom.db');
  });

  it('accepts :memory:', () => {
    const path = resolveSqlitePath({ databaseUrl: ':memory:' });
    expect(path).toBe(':memory:');
  });

  it('expands file: scheme', () => {
    const path = resolveSqlitePath({ databaseUrl: 'file:/tmp/foo.db' });
    expect(path).toBe('/tmp/foo.db');
  });

  it('expands sqlite: scheme', () => {
    const path = resolveSqlitePath({ databaseUrl: 'sqlite:/tmp/bar.db' });
    expect(path).toBe('/tmp/bar.db');
  });

  it('throws Hipp0NotImplementedError for postgres:// URLs', () => {
    expect(() => resolveSqlitePath({ databaseUrl: 'postgres://user:pw@host:5432/db' })).toThrow(
      Hipp0NotImplementedError,
    );
  });

  it('throws Hipp0NotImplementedError for postgresql:// URLs', () => {
    expect(() => resolveSqlitePath({ databaseUrl: 'postgresql://user:pw@host:5432/db' })).toThrow(
      Hipp0NotImplementedError,
    );
  });

  it('throws plain Error for unknown schemes', () => {
    expect(() => resolveSqlitePath({ databaseUrl: 'mysql://nope' })).toThrow(
      /Unrecognized DATABASE_URL scheme/,
    );
  });
});

describe('db: migrations + CRUD (in-memory SQLite)', () => {
  let db: HipppoDb;

  beforeEach(() => {
    db = createClient({ databaseUrl: ':memory:' });
    runMigrations(db);
  });

  afterEach(() => {
    closeClient(db);
  });

  it('creates all 13 tables', () => {
    const rows = db.$client
      .prepare(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '__drizzle%'`,
      )
      .all() as Array<{ name: string }>;
    const names = new Set(rows.map((r) => r.name));

    for (const expected of [
      'projects',
      'decisions',
      'decision_edges',
      'outcomes',
      'skills',
      'skill_improvements',
      'memory_entries',
      'session_history',
      'user_models',
      'agent_skills_profile',
      'health_events',
      'audit_log',
      'llm_usage',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it('creates the FTS5 virtual table', () => {
    const row = db.$client
      .prepare(`SELECT name FROM sqlite_master WHERE name='session_history_fts'`)
      .get() as { name: string } | undefined;
    expect(row?.name).toBe('session_history_fts');
  });

  it('enforces foreign keys (pragma set)', () => {
    const row = db.$client.pragma('foreign_keys', { simple: true });
    expect(row).toBe(1);
  });

  it('inserts a project and retrieves it', async () => {
    const [p] = await db
      .insert(projects)
      .values({ name: 'Test Project', description: 'smoke test' })
      .returning();
    expect(p).toBeDefined();
    expect(p!.id).toMatch(/^[0-9a-f]{8}-/); // UUID v4 shape
    expect(p!.name).toBe('Test Project');
    expect(p!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const fetched = await db.select().from(projects).where(eq(projects.id, p!.id));
    expect(fetched).toHaveLength(1);
    expect(fetched[0]!.description).toBe('smoke test');
  });

  it('inserts a decision with JSON columns and retrieves them', async () => {
    const [p] = await db.insert(projects).values({ name: 'P' }).returning();
    const [d] = await db
      .insert(decisions)
      .values({
        projectId: p!.id,
        title: 'Use Drizzle',
        reasoning: 'type-safe, multi-dialect, good DX',
        madeBy: 'agent:lead',
        affects: ['packages/memory'],
        confidence: 'high',
        tags: ['db', 'orm'],
      })
      .returning();

    expect(d!.affects).toEqual(['packages/memory']);
    expect(d!.tags).toEqual(['db', 'orm']);
    expect(d!.status).toBe('active'); // default
    expect(d!.confidence).toBe('high');
  });

  it('cascade-deletes decisions when project is removed', async () => {
    const [p] = await db.insert(projects).values({ name: 'Cascade' }).returning();
    await db.insert(decisions).values({
      projectId: p!.id,
      title: 't',
      reasoning: 'r',
      madeBy: 'x',
      confidence: 'medium',
    });

    await db.delete(projects).where(eq(projects.id, p!.id));

    const remaining = await db.select().from(decisions).where(eq(decisions.projectId, p!.id));
    expect(remaining).toHaveLength(0);
  });

  it('creates edges between decisions', async () => {
    const [p] = await db.insert(projects).values({ name: 'Edges' }).returning();
    const [a] = await db
      .insert(decisions)
      .values({
        projectId: p!.id,
        title: 'A',
        reasoning: 'r',
        madeBy: 'x',
        confidence: 'high',
      })
      .returning();
    const [b] = await db
      .insert(decisions)
      .values({
        projectId: p!.id,
        title: 'B',
        reasoning: 'r',
        madeBy: 'x',
        confidence: 'low',
      })
      .returning();

    const [e] = await db
      .insert(decisionEdges)
      .values({ sourceId: a!.id, targetId: b!.id, relationship: 'supersedes', weight: 0.9 })
      .returning();

    expect(e!.relationship).toBe('supersedes');
    expect(e!.weight).toBeCloseTo(0.9);
  });

  it('FTS5 mirror finds session_history by full-text match', async () => {
    const [p] = await db.insert(projects).values({ name: 'FTS' }).returning();
    await db.insert(sessionHistory).values({
      projectId: p!.id,
      agentId: 'agent:lead',
      summary: 'Debugging the migration pipeline',
      fullText:
        'We traced a flaky test to a missing FTS5 trigger. The virtual table now reindexes on update.',
    });

    const hits = db.$client
      .prepare(`SELECT rowid FROM session_history_fts WHERE session_history_fts MATCH 'trigger'`)
      .all();
    expect(hits).toHaveLength(1);
  });
});
