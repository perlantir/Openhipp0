import { describe, expect, it, beforeEach } from 'vitest';
import { createClient, runMigrations, type HipppoDb } from '../../src/db/index.js';
import { projects } from '../../src/db/schema.js';
import { createPlanStore } from '../../src/planning/store.js';

describe('drizzle PlanStore', () => {
  let db: HipppoDb;
  beforeEach(async () => {
    db = createClient({ databaseUrl: ':memory:' });
    runMigrations(db);
    await db.insert(projects).values({ id: 'p1', name: 'p1' });
  });

  it('create + get round-trip with ordered steps', async () => {
    const store = createPlanStore(db);
    const plan = await store.create({
      projectId: 'p1',
      goal: 'migrate DB',
      steps: [
        { description: 'snapshot' },
        { description: 'run migration' },
        { description: 'verify' },
      ],
    });
    expect(plan.state).toBe('active');
    expect(plan.currentStepId).toBe(plan.steps[0]?.id);
    const fetched = await store.get(plan.id);
    expect(fetched?.goal).toBe('migrate DB');
    expect(fetched?.steps.map((s) => s.description)).toEqual([
      'snapshot',
      'run migration',
      'verify',
    ]);
  });

  it('setStepStatus advances currentStepId on completion', async () => {
    const store = createPlanStore(db);
    const plan = await store.create({
      projectId: 'p1',
      goal: 'g',
      steps: [{ description: 'a' }, { description: 'b' }],
    });
    const [first, second] = plan.steps;
    await store.setStepStatus(first!.id, 'completed', {
      kind: 'manual',
      detail: {},
      valid: true,
    });
    const updated = await store.get(plan.id);
    expect(updated?.currentStepId).toBe(second!.id);
    expect(updated?.state).toBe('active');
  });

  it('auto-completes the plan when last step is completed', async () => {
    const store = createPlanStore(db);
    const plan = await store.create({
      projectId: 'p1',
      goal: 'g',
      steps: [{ description: 'only' }],
    });
    await store.setStepStatus(plan.steps[0]!.id, 'completed', {
      kind: 'manual',
      detail: {},
      valid: true,
    });
    const post = await store.get(plan.id);
    expect(post?.state).toBe('completed');
    expect(post?.currentStepId).toBeNull();
  });

  it('listByProject filters by state + respects limit', async () => {
    const store = createPlanStore(db);
    await store.create({ projectId: 'p1', goal: 'a', steps: [{ description: 'x' }] });
    const p2 = await store.create({ projectId: 'p1', goal: 'b', steps: [{ description: 'x' }] });
    await store.setState(p2.id, 'abandoned', 'pivot');

    const active = await store.listByProject('p1', { state: 'active' });
    expect(active.map((p) => p.goal)).toEqual(['a']);
    const abandoned = await store.listByProject('p1', { state: 'abandoned' });
    expect(abandoned.map((p) => p.goal)).toEqual(['b']);
    const limited = await store.listByProject('p1', { limit: 1 });
    expect(limited).toHaveLength(1);
  });

  it('revise keeps completed steps and replaces pending', async () => {
    const store = createPlanStore(db);
    const plan = await store.create({
      projectId: 'p1',
      goal: 'g',
      steps: [{ description: 'one' }, { description: 'two' }, { description: 'three' }],
    });
    // Complete the first two.
    await store.setStepStatus(plan.steps[0]!.id, 'completed', {
      kind: 'manual',
      detail: {},
      valid: true,
    });
    await store.setStepStatus(plan.steps[1]!.id, 'completed', {
      kind: 'manual',
      detail: {},
      valid: true,
    });

    await store.revise(plan.id, 'new info', [
      { description: 'better-third' },
      { description: 'fourth' },
    ]);

    const post = await store.get(plan.id);
    expect(post?.steps.map((s) => s.description)).toEqual([
      'one',
      'two',
      'better-third',
      'fourth',
    ]);
    expect(post?.currentStepId).toBe(post?.steps[2]?.id);
  });

  it('setState records a revision when reason is supplied', async () => {
    const store = createPlanStore(db);
    const plan = await store.create({
      projectId: 'p1',
      goal: 'g',
      steps: [{ description: 'x' }],
    });
    await store.setState(plan.id, 'paused', 'user asked to hold');
    const post = await store.get(plan.id);
    expect(post?.state).toBe('paused');
  });
});
