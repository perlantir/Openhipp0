import { beforeEach, describe, expect, it } from 'vitest';
import { createClient, runMigrations, type HipppoDb } from '../../src/db/index.js';
import { projects, userFeedback } from '../../src/db/schema.js';
import {
  clampDailyChange,
  computePerUserSkillReward,
  computeSkillReward,
  implicitRewardFromTrajectory,
} from '../../src/learning/reward-model.js';

async function seedFeedback(
  db: HipppoDb,
  rows: Array<{
    userId: string;
    rating: number;
    source?: 'explicit' | 'implicit';
    skillId?: string;
    createdAt?: string;
  }>,
) {
  for (const r of rows) {
    await db.insert(userFeedback).values({
      projectId: 'p1',
      userId: r.userId,
      rating: r.rating,
      source: r.source ?? 'explicit',
      ...(r.skillId && { skillId: r.skillId }),
      ...(r.createdAt && { createdAt: r.createdAt }),
    });
  }
}

describe('computeSkillReward', () => {
  let db: HipppoDb;
  beforeEach(async () => {
    db = createClient({ databaseUrl: ':memory:' });
    runMigrations(db);
    await db.insert(projects).values({ id: 'p1', name: 'p1' });
  });

  it('empty feedback → reward 0 (prior pulls to neutral)', async () => {
    const r = await computeSkillReward(db, 'sk-1');
    expect(r.reward).toBe(0);
    expect(r.explicit.n).toBe(0);
    expect(r.globallyTrusted).toBe(false);
  });

  it('one user + many thumbs-up → reward < 1 (Bayesian shrink)', async () => {
    await seedFeedback(db, Array.from({ length: 5 }, () => ({ userId: 'u1', rating: 1, skillId: 'sk' })));
    const r = await computeSkillReward(db, 'sk');
    expect(r.reward).toBeGreaterThan(0.3);
    expect(r.reward).toBeLessThan(1);
    // Single user → NOT globally trusted.
    expect(r.globallyTrusted).toBe(false);
  });

  it('5 distinct users all +1 → globallyTrusted=true', async () => {
    await seedFeedback(
      db,
      ['u1', 'u2', 'u3', 'u4', 'u5'].map((u) => ({ userId: u, rating: 1, skillId: 'sk' })),
    );
    const r = await computeSkillReward(db, 'sk');
    expect(r.explicit.distinctUsers).toBe(5);
    expect(r.globallyTrusted).toBe(true);
    // 5 +1s with prior N=5 → explicit.mean = 5/10 = 0.5; combined with zero
    // implicit at weight 0.3 gives ≈ 0.385. Confirms prior shrinkage works.
    expect(r.reward).toBeGreaterThan(0.3);
    expect(r.reward).toBeLessThan(0.55);
  });

  it('old feedback decays — ancient +1s don\'t dominate', async () => {
    // 5 ancient +1s, 5 fresh 0s.
    const ancient = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
    await seedFeedback(db, [
      ...Array.from({ length: 5 }, (_, i) => ({
        userId: `u${i}`,
        rating: 1,
        skillId: 'sk',
        createdAt: ancient,
      })),
      ...Array.from({ length: 5 }, (_, i) => ({
        userId: `v${i}`,
        rating: 0,
        skillId: 'sk',
      })),
    ]);
    const r = await computeSkillReward(db, 'sk');
    // 365 days of decay → weight ~ 0.5^(365/90) ≈ 0.06, so old rows almost
    // don't count. Overall should trend toward 0.
    expect(Math.abs(r.reward)).toBeLessThan(0.1);
  });

  it('explicit dominates implicit (default weight)', async () => {
    await seedFeedback(db, [
      { userId: 'u1', rating: -1, source: 'explicit', skillId: 'sk' },
      { userId: 'u1', rating: -1, source: 'explicit', skillId: 'sk' },
      { userId: 'u1', rating: 1, source: 'implicit', skillId: 'sk' },
      { userId: 'u1', rating: 1, source: 'implicit', skillId: 'sk' },
      { userId: 'u1', rating: 1, source: 'implicit', skillId: 'sk' },
    ]);
    const r = await computeSkillReward(db, 'sk');
    // Explicit pull (-1) should win.
    expect(r.reward).toBeLessThan(0);
  });

  it('per-user reward isolates from other users', async () => {
    await seedFeedback(db, [
      { userId: 'u1', rating: 1, skillId: 'sk' },
      { userId: 'u2', rating: -1, skillId: 'sk' },
    ]);
    const r1 = await computePerUserSkillReward(db, 'sk', 'u1');
    const r2 = await computePerUserSkillReward(db, 'sk', 'u2');
    expect(r1.reward).toBeGreaterThan(r2.reward);
  });
});

describe('clampDailyChange', () => {
  it('rises are unbounded', () => {
    expect(clampDailyChange(1, 10)).toBe(10);
  });

  it('drops are capped at -20% by default', () => {
    // next=0 would be a 100% drop → clamp to 80% of previous.
    expect(clampDailyChange(1, 0)).toBeCloseTo(0.8, 5);
  });

  it('small drops pass through', () => {
    expect(clampDailyChange(1, 0.9)).toBe(0.9);
  });

  it('custom max drop', () => {
    expect(clampDailyChange(1, 0, 0.5)).toBeCloseTo(0.5, 5);
  });
});

describe('implicitRewardFromTrajectory', () => {
  it('task-complete + no repeat → +0.5', () => {
    expect(
      implicitRewardFromTrajectory({ taskCompleteMarker: true, userRepeatedAsk: false }),
    ).toBe(0.5);
  });
  it('user repeated ask → -0.5 (outweighs task-complete)', () => {
    expect(
      implicitRewardFromTrajectory({ taskCompleteMarker: true, userRepeatedAsk: true }),
    ).toBe(-0.5);
  });
  it('neither → 0 (abstain, no spoofable signal)', () => {
    expect(
      implicitRewardFromTrajectory({ taskCompleteMarker: false, userRepeatedAsk: false }),
    ).toBe(0);
  });
});
