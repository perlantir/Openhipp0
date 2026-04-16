import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, runMigrations, type HipppoDb } from '../../src/db/index.js';
import { projects, skills, userFeedback } from '../../src/db/schema.js';
import { listSkillsForRecallWithReward } from '../../src/learning/skills-rank.js';

describe('listSkillsForRecallWithReward (shadow rank)', () => {
  let db: HipppoDb;
  beforeEach(async () => {
    db = createClient({ databaseUrl: ':memory:' });
    runMigrations(db);
    await db.insert(projects).values({ id: 'p1', name: 'p1' });
  });

  it('when no feedback exists, shadow rank equals primary rank', async () => {
    await db.insert(skills).values({
      projectId: 'p1',
      agentId: 'a',
      title: 'plain',
      contentMd: '.',
      timesUsed: 10,
      successRate: 0.8,
    });
    const results = await listSkillsForRecallWithReward(db, 'p1');
    expect(results[0]?.reward).toBe(0);
    expect(results[0]?.shadowRank).toBeCloseTo(results[0]!.rank, 5);
  });

  it('does NOT apply reward to global shadow when fewer than 5 distinct users', async () => {
    const [skill] = await db
      .insert(skills)
      .values({
        projectId: 'p1',
        agentId: 'a',
        title: 'lightly-rated',
        contentMd: '.',
        timesUsed: 10,
        successRate: 0.8,
      })
      .returning();
    // Two users both rate +1 — not enough for global trust.
    for (const u of ['u1', 'u2']) {
      await db.insert(userFeedback).values({
        projectId: 'p1',
        userId: u,
        skillId: skill!.id,
        rating: 1,
        source: 'explicit',
      });
    }
    const results = await listSkillsForRecallWithReward(db, 'p1');
    expect(results[0]?.globallyTrusted).toBe(false);
    expect(results[0]?.reward).toBe(0);
    expect(results[0]?.shadowRank).toBeCloseTo(results[0]!.rank, 5);
  });

  it('applies reward to shadow once ≥5 users agree (globally trusted)', async () => {
    const [skill] = await db
      .insert(skills)
      .values({
        projectId: 'p1',
        agentId: 'a',
        title: 'widely-loved',
        contentMd: '.',
        timesUsed: 10,
        successRate: 0.8,
      })
      .returning();
    for (const u of ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']) {
      await db.insert(userFeedback).values({
        projectId: 'p1',
        userId: u,
        skillId: skill!.id,
        rating: 1,
        source: 'explicit',
      });
    }
    const results = await listSkillsForRecallWithReward(db, 'p1');
    expect(results[0]?.globallyTrusted).toBe(true);
    expect(results[0]?.reward).toBeGreaterThan(0);
    expect(results[0]?.shadowRank).toBeGreaterThan(results[0]!.rank);
  });

  it('clamps shadow drops at maxDailyDrop (20% default)', async () => {
    const [skill] = await db
      .insert(skills)
      .values({
        projectId: 'p1',
        agentId: 'a',
        title: 'hated',
        contentMd: '.',
        timesUsed: 10,
        successRate: 0.8,
      })
      .returning();
    // 6 users all -1 → globally trusted negative reward.
    for (const u of ['u1', 'u2', 'u3', 'u4', 'u5', 'u6']) {
      await db.insert(userFeedback).values({
        projectId: 'p1',
        userId: u,
        skillId: skill!.id,
        rating: -1,
        source: 'explicit',
      });
    }
    const results = await listSkillsForRecallWithReward(db, 'p1');
    const row = results[0]!;
    // raw formula would be rank × (1 + 0.5 × -1) = rank × 0.5. That's a 50%
    // drop — must be clamped to 80% of original = 20% max drop.
    expect(row.shadowRank / row.rank).toBeGreaterThanOrEqual(0.8 - 1e-6);
  });
});
