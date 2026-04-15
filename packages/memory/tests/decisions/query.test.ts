import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeClient, createClient, runMigrations, type HipppoDb } from '../../src/db/index.js';
import { projects } from '../../src/db/schema.js';
import {
  createDecision,
  DeterministicEmbeddingProvider,
  filterByTags,
  listByProject,
  semanticSearch,
  supersedeDecision,
} from '../../src/decisions/index.js';

let db: HipppoDb;
let projectId: string;
const embed = new DeterministicEmbeddingProvider(256, 3);

beforeEach(async () => {
  db = createClient({ databaseUrl: ':memory:' });
  runMigrations(db);
  const [p] = await db.insert(projects).values({ name: 'Test' }).returning();
  projectId = p!.id;
});

afterEach(() => {
  closeClient(db);
});

describe('listByProject', () => {
  it('returns newest decisions first', async () => {
    await createDecision(db, {
      projectId,
      title: 'old',
      reasoning: 'r',
      madeBy: 'x',
      confidence: 'high',
    });
    // Ensure a different createdAt — SQLite ISO strings have ms precision.
    await new Promise((r) => setTimeout(r, 5));
    const newer = await createDecision(db, {
      projectId,
      title: 'new',
      reasoning: 'r',
      madeBy: 'x',
      confidence: 'high',
    });

    const rows = await listByProject(db, projectId);
    expect(rows[0]!.id).toBe(newer.id);
    expect(rows[0]!.title).toBe('new');
  });

  it('respects status filter', async () => {
    const a = await createDecision(db, {
      projectId,
      title: 'a',
      reasoning: 'r',
      madeBy: 'x',
      confidence: 'high',
    });
    const b = await createDecision(db, {
      projectId,
      title: 'b',
      reasoning: 'r',
      madeBy: 'x',
      confidence: 'high',
    });
    await supersedeDecision(db, a.id, b.id);
    expect((await listByProject(db, projectId, { status: 'active' })).map((r) => r.id)).toEqual([
      b.id,
    ]);
    expect((await listByProject(db, projectId, { status: 'superseded' })).map((r) => r.id)).toEqual(
      [a.id],
    );
  });

  it('honors limit + offset', async () => {
    for (let i = 0; i < 5; i++) {
      await createDecision(db, {
        projectId,
        title: `d${i}`,
        reasoning: 'r',
        madeBy: 'x',
        confidence: 'high',
      });
      await new Promise((r) => setTimeout(r, 2));
    }
    const page1 = await listByProject(db, projectId, { limit: 2, offset: 0 });
    const page2 = await listByProject(db, projectId, { limit: 2, offset: 2 });
    expect(page1).toHaveLength(2);
    expect(page2).toHaveLength(2);
    expect(page1[0]!.id).not.toBe(page2[0]!.id);
  });
});

describe('semanticSearch', () => {
  beforeEach(async () => {
    // Seed three decisions with different themes.
    await createDecision(
      db,
      {
        projectId,
        title: 'Use PostgreSQL with pgvector',
        reasoning: 'Durability and ANN search out of the box',
        madeBy: 'x',
        confidence: 'high',
        tags: ['database', 'postgres'],
      },
      { embeddingProvider: embed },
    );
    await createDecision(
      db,
      {
        projectId,
        title: 'Ship a React dashboard',
        reasoning: 'Frontend with Tailwind and shadcn',
        madeBy: 'x',
        confidence: 'medium',
        tags: ['frontend', 'react'],
      },
      { embeddingProvider: embed },
    );
    await createDecision(
      db,
      {
        projectId,
        title: 'Lunch should be sandwiches',
        reasoning: 'Team prefers sandwich options on Mondays',
        madeBy: 'x',
        confidence: 'low',
        tags: ['food'],
      },
      { embeddingProvider: embed },
    );
  });

  it('ranks database query above sandwich', async () => {
    const hits = await semanticSearch(
      db,
      projectId,
      'Which database should we use for vector search?',
      embed,
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.decision.title).toMatch(/PostgreSQL/i);
    // The sandwich entry should have the lowest score (or be below the DB entry).
    const sandwichHit = hits.find((h) => h.decision.title.includes('sandwich'));
    const dbHit = hits.find((h) => h.decision.title.includes('PostgreSQL'));
    expect(dbHit!.score).toBeGreaterThan(sandwichHit!.score);
  });

  it('applies minScore threshold', async () => {
    const hits = await semanticSearch(db, projectId, 'zzz unrelated gibberish', embed, {
      minScore: 0.99,
    });
    expect(hits).toHaveLength(0);
  });

  it('respects limit', async () => {
    const hits = await semanticSearch(db, projectId, 'anything', embed, { limit: 1 });
    expect(hits).toHaveLength(1);
  });

  it('skips rows without embeddings without failing', async () => {
    // Add one with skipEmbedding
    await createDecision(
      db,
      {
        projectId,
        title: 'orphan',
        reasoning: 'no embedding',
        madeBy: 'x',
        confidence: 'high',
      },
      { embeddingProvider: embed, skipEmbedding: true },
    );
    const hits = await semanticSearch(db, projectId, 'query', embed);
    expect(hits.every((h) => h.decision.title !== 'orphan')).toBe(true);
  });

  it('status=null returns superseded rows too', async () => {
    // Supersede the dashboard decision.
    const rows = await listByProject(db, projectId, { limit: 20 });
    const dashboard = rows.find((r) => r.title.includes('dashboard'))!;
    const replacement = await createDecision(
      db,
      {
        projectId,
        title: 'Ship a Vue dashboard instead',
        reasoning: 'team change',
        madeBy: 'x',
        confidence: 'medium',
      },
      { embeddingProvider: embed },
    );
    await supersedeDecision(db, dashboard.id, replacement.id);

    const defaultHits = await semanticSearch(db, projectId, 'dashboard frontend', embed);
    expect(defaultHits.find((h) => h.decision.id === dashboard.id)).toBeUndefined();

    const allHits = await semanticSearch(db, projectId, 'dashboard frontend', embed, {
      status: null,
    });
    expect(allHits.find((h) => h.decision.id === dashboard.id)).toBeDefined();
  });
});

describe('filterByTags', () => {
  beforeEach(async () => {
    await createDecision(db, {
      projectId,
      title: 'A',
      reasoning: 'r',
      madeBy: 'x',
      confidence: 'high',
      tags: ['database', 'postgres'],
    });
    await createDecision(db, {
      projectId,
      title: 'B',
      reasoning: 'r',
      madeBy: 'x',
      confidence: 'high',
      tags: ['frontend'],
    });
    await createDecision(db, {
      projectId,
      title: 'C',
      reasoning: 'r',
      madeBy: 'x',
      confidence: 'high',
      tags: ['database', 'redis'],
    });
  });

  it('ranks overlap highest', () => {
    const hits = filterByTags(db, projectId, ['database', 'postgres']);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.decision.title).toBe('A');
    expect(hits[0]!.score).toBe(1);
  });

  it('returns partial overlaps with lower score', () => {
    const hits = filterByTags(db, projectId, ['database']);
    const a = hits.find((h) => h.decision.title === 'A');
    const c = hits.find((h) => h.decision.title === 'C');
    expect(a!.score).toBeCloseTo(1 / 2); // 1 overlap, union 2 (database, postgres)
    expect(c!.score).toBeCloseTo(1 / 2); // 1 overlap, union 2 (database, redis)
  });

  it('empty queryTags returns zero-scored hits', () => {
    const hits = filterByTags(db, projectId, []);
    expect(hits.every((h) => h.score === 0)).toBe(true);
  });
});
