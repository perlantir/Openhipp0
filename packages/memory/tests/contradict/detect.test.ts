import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectContradictions,
  detectContradictionsForText,
  opposingConclusions,
  recordContradictions,
  type ContradictionClassifier,
} from '../../src/contradict/index.js';
import { closeClient, createClient, runMigrations, type HipppoDb } from '../../src/db/index.js';
import { projects } from '../../src/db/schema.js';
import {
  createDecision,
  DeterministicEmbeddingProvider,
  outgoingEdges,
} from '../../src/decisions/index.js';

describe('opposingConclusions heuristic', () => {
  it('flags negation flip', () => {
    const r = opposingConclusions(
      { title: 'Use PostgreSQL', reasoning: 'Durable, open source.' },
      { title: 'Do not use PostgreSQL', reasoning: 'Ops cost too high.' },
    );
    expect(r.opposing).toBe(true);
    expect(r.reason).toMatch(/negation/i);
  });

  it('flags aversive vs positive verb', () => {
    const r = opposingConclusions(
      { title: 'Adopt Redis for caching', reasoning: 'Fast reads.' },
      { title: 'Avoid Redis in production', reasoning: 'Ops burden.' },
    );
    expect(r.opposing).toBe(true);
    expect(r.reason).toMatch(/aversive|avoid/i);
  });

  it('does NOT flag two agreeing decisions', () => {
    const r = opposingConclusions(
      { title: 'Use PostgreSQL', reasoning: 'Good defaults.' },
      { title: 'Adopt PostgreSQL', reasoning: 'Reliable.' },
    );
    expect(r.opposing).toBe(false);
  });

  it('does NOT flag when both contain negation', () => {
    const r = opposingConclusions(
      { title: 'Do not use Redis', reasoning: 'Overhead.' },
      { title: 'Avoid Redis', reasoning: 'Complexity.' },
    );
    expect(r.opposing).toBe(false);
  });
});

describe('detectContradictions (hard band)', () => {
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

  it('flags a near-duplicate with opposite negation as high-confidence contradiction', async () => {
    // Existing decision: positive.
    await createDecision(
      db,
      {
        projectId,
        title: 'Use PostgreSQL for durability',
        reasoning: 'Good defaults and pgvector support.',
        madeBy: 'a1',
        confidence: 'high',
      },
      { embeddingProvider: embed },
    );
    // Candidate: same topic, negated.
    const title = 'Do not use PostgreSQL for durability';
    const reasoning = 'Good defaults and pgvector support, but ops too heavy.';
    const candidateEmbedding = await embed.embed(`${title}\n${reasoning}`);

    const cands = await detectContradictions(
      db,
      { projectId, title, reasoning, embedding: candidateEmbedding },
      { hardSim: 0.7 }, // stub embeddings have lower max similarity than real models
    );
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]!.confidence).toBe('high');
    expect(cands[0]!.reason).toMatch(/negation/i);
  });

  it('does NOT flag high-sim but agreeing pairs', async () => {
    await createDecision(
      db,
      {
        projectId,
        title: 'Use PostgreSQL',
        reasoning: 'Good defaults.',
        madeBy: 'a1',
        confidence: 'high',
      },
      { embeddingProvider: embed },
    );
    const title = 'Adopt PostgreSQL';
    const reasoning = 'Great defaults.';
    const embedding = await embed.embed(`${title}\n${reasoning}`);

    const cands = await detectContradictions(
      db,
      { projectId, title, reasoning, embedding },
      { hardSim: 0.5 },
    );
    expect(cands).toHaveLength(0);
  });

  it('honors excludeIds (the new decision itself)', async () => {
    const self = await createDecision(
      db,
      {
        projectId,
        title: 'Do not use PostgreSQL',
        reasoning: 'Ops burden.',
        madeBy: 'a1',
        confidence: 'high',
      },
      { embeddingProvider: embed },
    );
    const embedding = await embed.embed(`${self.title}\n${self.reasoning}`);
    const cands = await detectContradictions(
      db,
      { projectId, title: self.title, reasoning: self.reasoning, embedding },
      { hardSim: 0.5, excludeIds: [self.id] },
    );
    expect(cands.find((c) => c.decision.id === self.id)).toBeUndefined();
  });

  it('skips decisions without embeddings', async () => {
    await createDecision(db, {
      projectId,
      title: 'Use PostgreSQL',
      reasoning: 'r',
      madeBy: 'a1',
      confidence: 'high',
    }); // no embedding
    const candidateTitle = 'Do not use PostgreSQL';
    const embedding = await embed.embed(candidateTitle);
    const cands = await detectContradictions(
      db,
      { projectId, title: candidateTitle, reasoning: 'r', embedding },
      { hardSim: 0.5 },
    );
    expect(cands).toHaveLength(0);
  });
});

describe('detectContradictions (classifier band)', () => {
  let db: HipppoDb;
  let projectId: string;
  const embed = new DeterministicEmbeddingProvider(256, 3);

  beforeEach(async () => {
    db = createClient({ databaseUrl: ':memory:' });
    runMigrations(db);
    const [p] = await db.insert(projects).values({ name: 'Test' }).returning();
    projectId = p!.id;
  });

  afterEach(() => closeClient(db));

  it('invokes classifier for pairs in the 0.7–0.85 band', async () => {
    await createDecision(
      db,
      {
        projectId,
        title: 'Prefer TypeScript for backend',
        reasoning: 'Strong types, ecosystem.',
        madeBy: 'a1',
        confidence: 'high',
      },
      { embeddingProvider: embed },
    );
    const classifier: ContradictionClassifier = vi.fn(async () => true);
    const candidateTitle = 'Adopt Go on the backend instead';
    const reasoning = 'Simpler concurrency.';
    const embedding = await embed.embed(`${candidateTitle}\n${reasoning}`);

    // Use a llmSimMin below what stub embeddings yield for any related text
    const cands = await detectContradictions(
      db,
      { projectId, title: candidateTitle, reasoning, embedding },
      { hardSim: 0.99, llmSimMin: 0.01, classifier },
    );
    expect(classifier).toHaveBeenCalled();
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[0]!.confidence).toBe('medium');
  });

  it('classifier returning false means no flag', async () => {
    await createDecision(
      db,
      {
        projectId,
        title: 'Ship React dashboard',
        reasoning: 'Frontend.',
        madeBy: 'a1',
        confidence: 'high',
      },
      { embeddingProvider: embed },
    );
    const classifier: ContradictionClassifier = async () => false;
    const title = 'Ship Vue dashboard too';
    const reasoning = 'Experimental.';
    const embedding = await embed.embed(`${title}\n${reasoning}`);

    const cands = await detectContradictions(
      db,
      { projectId, title, reasoning, embedding },
      { hardSim: 0.99, llmSimMin: 0.01, classifier },
    );
    expect(cands).toHaveLength(0);
  });

  it('no classifier supplied → the ambiguous band is silently skipped', async () => {
    await createDecision(
      db,
      {
        projectId,
        title: 'Use Redis',
        reasoning: 'r',
        madeBy: 'a1',
        confidence: 'high',
      },
      { embeddingProvider: embed },
    );
    const cands = await detectContradictions(
      db,
      {
        projectId,
        title: 'Something vaguely related',
        reasoning: 'x',
        embedding: await embed.embed('Something vaguely related\nx'),
      },
      { hardSim: 0.99, llmSimMin: 0.01 }, // no classifier
    );
    expect(cands).toHaveLength(0);
  });
});

describe('recordContradictions', () => {
  let db: HipppoDb;
  let projectId: string;
  const embed = new DeterministicEmbeddingProvider(256, 3);

  beforeEach(async () => {
    db = createClient({ databaseUrl: ':memory:' });
    runMigrations(db);
    const [p] = await db.insert(projects).values({ name: 'Test' }).returning();
    projectId = p!.id;
  });
  afterEach(() => closeClient(db));

  it('writes one `contradicts` edge per candidate, weighted by confidence', async () => {
    const a = await createDecision(
      db,
      {
        projectId,
        title: 'Use PostgreSQL',
        reasoning: 'r',
        madeBy: 'x',
        confidence: 'high',
      },
      { embeddingProvider: embed },
    );
    const b = await createDecision(
      db,
      {
        projectId,
        title: 'Do not use PostgreSQL',
        reasoning: 'r2',
        madeBy: 'x',
        confidence: 'high',
      },
      { embeddingProvider: embed },
    );

    const candidates = await detectContradictionsForText(
      db,
      projectId,
      b.title,
      b.reasoning,
      embed,
      { hardSim: 0.5, excludeIds: [b.id] },
    );
    const written = await recordContradictions(db, b.id, candidates);
    expect(written).toBeGreaterThan(0);

    const edges = await outgoingEdges(db, b.id, 'contradicts');
    expect(edges.find((e) => e.targetId === a.id)?.weight).toBeCloseTo(0.95);
  });

  it('is idempotent (upserts on same source/target/relationship)', async () => {
    const a = await createDecision(
      db,
      {
        projectId,
        title: 'Use PostgreSQL',
        reasoning: 'r',
        madeBy: 'x',
        confidence: 'high',
      },
      { embeddingProvider: embed },
    );
    const b = await createDecision(
      db,
      {
        projectId,
        title: 'Do not use PostgreSQL',
        reasoning: 'r2',
        madeBy: 'x',
        confidence: 'high',
      },
      { embeddingProvider: embed },
    );
    const cands = await detectContradictionsForText(db, projectId, b.title, b.reasoning, embed, {
      hardSim: 0.5,
      excludeIds: [b.id],
    });
    await recordContradictions(db, b.id, cands);
    await recordContradictions(db, b.id, cands);
    const edges = await outgoingEdges(db, b.id, 'contradicts');
    expect(edges.filter((e) => e.targetId === a.id)).toHaveLength(1);
  });
});
