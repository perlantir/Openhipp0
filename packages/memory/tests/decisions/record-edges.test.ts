import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeClient, createClient, runMigrations, type HipppoDb } from '../../src/db/index.js';
import { projects } from '../../src/db/schema.js';
import {
  createDecision,
  decodeEmbedding,
  deleteDecision,
  deleteEdge,
  DeterministicEmbeddingProvider,
  getDecision,
  incomingEdges,
  insertEdge,
  outgoingEdges,
  supersedeDecision,
  updateDecision,
} from '../../src/decisions/index.js';

let db: HipppoDb;
let projectId: string;
const embed = new DeterministicEmbeddingProvider(64);

beforeEach(async () => {
  db = createClient({ databaseUrl: ':memory:' });
  runMigrations(db);
  const [p] = await db.insert(projects).values({ name: 'Test' }).returning();
  projectId = p!.id;
});

afterEach(() => {
  closeClient(db);
});

describe('createDecision', () => {
  it('inserts with normalized tags, returns the row', async () => {
    const d = await createDecision(db, {
      projectId,
      title: 'Use PostgreSQL',
      reasoning: 'Durability + pgvector support',
      madeBy: 'agent:lead',
      affects: ['packages/memory'],
      confidence: 'high',
      tags: ['DB', 'databases', 'orm'],
    });
    expect(d.title).toBe('Use PostgreSQL');
    expect(d.confidence).toBe('high');
    // 'DB' → 'db', 'databases' → 'database' (via s$ rule), 'orm' stays. Unique set of 3.
    expect(d.tags?.sort()).toEqual(['database', 'db', 'orm']);
    expect(d.status).toBe('active'); // default
    expect(d.embedding).toBeNull();
  });

  it('embeds inline when provider is supplied', async () => {
    const d = await createDecision(
      db,
      {
        projectId,
        title: 't',
        reasoning: 'r',
        madeBy: 'a',
        confidence: 'medium',
      },
      { embeddingProvider: embed },
    );
    const vec = decodeEmbedding(d);
    expect(vec).not.toBeNull();
    expect(vec!.length).toBe(64);
  });

  it('skips embedding when skipEmbedding=true', async () => {
    const d = await createDecision(
      db,
      { projectId, title: 't', reasoning: 'r', madeBy: 'a', confidence: 'low' },
      { embeddingProvider: embed, skipEmbedding: true },
    );
    expect(d.embedding).toBeNull();
  });
});

describe('getDecision / updateDecision', () => {
  it('round-trips via getDecision', async () => {
    const d = await createDecision(db, {
      projectId,
      title: 't',
      reasoning: 'r',
      madeBy: 'a',
      confidence: 'high',
    });
    const fetched = await getDecision(db, d.id);
    expect(fetched?.id).toBe(d.id);
  });

  it('updates tags with re-normalization', async () => {
    const d = await createDecision(db, {
      projectId,
      title: 't',
      reasoning: 'r',
      madeBy: 'a',
      confidence: 'high',
      tags: ['old'],
    });
    const updated = await updateDecision(db, d.id, { tags: ['NEW', 'news'] });
    expect(updated?.tags?.sort()).toEqual(['new']);
  });

  it('re-embeds when title or reasoning changes and provider is set', async () => {
    const d = await createDecision(
      db,
      { projectId, title: 'a', reasoning: 'r', madeBy: 'a', confidence: 'high' },
      { embeddingProvider: embed },
    );
    const before = d.embedding;
    const updated = await updateDecision(db, d.id, { title: 'b' }, { embeddingProvider: embed });
    expect(updated?.embedding).not.toBe(before);
  });

  it('does not re-embed when neither title nor reasoning change', async () => {
    const d = await createDecision(
      db,
      { projectId, title: 't', reasoning: 'r', madeBy: 'a', confidence: 'high' },
      { embeddingProvider: embed },
    );
    const before = d.embedding;
    const updated = await updateDecision(db, d.id, { tags: ['x'] }, { embeddingProvider: embed });
    expect(updated?.embedding).toBe(before);
  });
});

describe('supersedeDecision', () => {
  it('marks old as superseded and creates the supersedes edge', async () => {
    const oldDec = await createDecision(db, {
      projectId,
      title: 'Use SQLite',
      reasoning: 'simple',
      madeBy: 'a',
      confidence: 'medium',
    });
    const newDec = await createDecision(db, {
      projectId,
      title: 'Use PostgreSQL',
      reasoning: 'durability',
      madeBy: 'a',
      confidence: 'high',
    });

    await supersedeDecision(db, oldDec.id, newDec.id);

    const refreshedOld = await getDecision(db, oldDec.id);
    expect(refreshedOld?.status).toBe('superseded');
    expect(refreshedOld?.supersededBy).toBe(newDec.id);

    const edges = await outgoingEdges(db, newDec.id, 'supersedes');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.targetId).toBe(oldDec.id);
  });

  it('is idempotent', async () => {
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
    await supersedeDecision(db, a.id, b.id);
    const edges = await outgoingEdges(db, b.id, 'supersedes');
    expect(edges).toHaveLength(1);
  });

  it('throws when old does not exist', async () => {
    const b = await createDecision(db, {
      projectId,
      title: 'b',
      reasoning: 'r',
      madeBy: 'x',
      confidence: 'high',
    });
    await expect(
      supersedeDecision(db, '00000000-0000-4000-8000-000000000000', b.id),
    ).rejects.toThrow(/not found/);
  });
});

describe('deleteDecision cascades', () => {
  it('deletes linked edges when a decision is removed', async () => {
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
    await insertEdge(db, { sourceId: a.id, targetId: b.id, relationship: 'supports' });
    expect(await deleteDecision(db, a.id)).toBe(true);
    const edges = await outgoingEdges(db, a.id);
    expect(edges).toHaveLength(0);
  });
});

describe('edges: insert / incoming / outgoing / delete', () => {
  async function seed(): Promise<{ a: string; b: string; c: string }> {
    const make = async (title: string): Promise<string> => {
      const d = await createDecision(db, {
        projectId,
        title,
        reasoning: 'r',
        madeBy: 'x',
        confidence: 'high',
      });
      return d.id;
    };
    return { a: await make('A'), b: await make('B'), c: await make('C') };
  }

  it('upserts weight on duplicate (source, target, relationship)', async () => {
    const { a, b } = await seed();
    await insertEdge(db, { sourceId: a, targetId: b, relationship: 'related', weight: 0.5 });
    await insertEdge(db, { sourceId: a, targetId: b, relationship: 'related', weight: 0.9 });
    const edges = await outgoingEdges(db, a, 'related');
    expect(edges).toHaveLength(1);
    expect(edges[0]!.weight).toBeCloseTo(0.9);
  });

  it('rejects self-edges', async () => {
    const { a } = await seed();
    await expect(
      insertEdge(db, { sourceId: a, targetId: a, relationship: 'related' }),
    ).rejects.toThrow(/self-edges/);
  });

  it('incomingEdges / outgoingEdges filter by relationship', async () => {
    const { a, b, c } = await seed();
    await insertEdge(db, { sourceId: a, targetId: b, relationship: 'supports' });
    await insertEdge(db, { sourceId: a, targetId: c, relationship: 'contradicts' });

    const supports = await outgoingEdges(db, a, 'supports');
    expect(supports).toHaveLength(1);
    expect(supports[0]!.targetId).toBe(b);

    const intoB = await incomingEdges(db, b);
    expect(intoB).toHaveLength(1);
  });

  it('deleteEdge removes by id', async () => {
    const { a, b } = await seed();
    const e = await insertEdge(db, { sourceId: a, targetId: b, relationship: 'supports' });
    expect(await deleteEdge(db, e.id)).toBe(true);
    expect(await deleteEdge(db, e.id)).toBe(false);
  });
});

// For type tests — direct schema ref used to silence an unused-import warning
// on environments where tree-shaking doesn't reach unused db imports.
describe('schema sanity', () => {
  it('decisions table is queryable', async () => {
    const rows = await db
      .select()
      .from((await import('../../src/db/schema.js')).decisions)
      .where(eq((await import('../../src/db/schema.js')).decisions.projectId, projectId));
    expect(Array.isArray(rows)).toBe(true);
  });
});
