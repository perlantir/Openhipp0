import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeClient, createClient, runMigrations, type HipppoDb } from '../../src/db/index.js';
import { projects, userModels, type UserModel } from '../../src/db/schema.js';
import {
  applyUpdate,
  getUserModel,
  mergePatch,
  renderUserModelSnippet,
  type UserModelUpdater,
} from '../../src/user-model/index.js';
import { eq } from 'drizzle-orm';

let db: HipppoDb;
let projectId: string;

beforeEach(async () => {
  db = createClient({ databaseUrl: ':memory:' });
  runMigrations(db);
  const [p] = await db.insert(projects).values({ name: 'T' }).returning();
  projectId = p!.id;
});
afterEach(() => closeClient(db));

function freshModel(): UserModel {
  return {
    id: 'uid',
    userId: 'u1',
    projectId: 'p1',
    communicationStyle: null,
    expertiseDomains: [],
    workflowPreferences: {},
    activeProjects: [],
    toolPreferences: {},
    riskTolerance: 'medium',
    interactionCount: 0,
    updatedAt: new Date().toISOString(),
  };
}

describe('mergePatch', () => {
  it('adds and removes expertise domains as a set', () => {
    const base = { ...freshModel(), expertiseDomains: ['typescript'] };
    const merged = mergePatch(base, {
      expertiseDomainsAdd: ['rust', 'typescript'],
      expertiseDomainsRemove: [],
    });
    expect(merged.expertiseDomains.sort()).toEqual(['rust', 'typescript']);
  });

  it('removes from expertise domains', () => {
    const base = { ...freshModel(), expertiseDomains: ['typescript', 'rust'] };
    const merged = mergePatch(base, { expertiseDomainsRemove: ['rust'] });
    expect(merged.expertiseDomains).toEqual(['typescript']);
  });

  it('workflowPreferences: merge on set, delete on list', () => {
    const base = { ...freshModel(), workflowPreferences: { a: 1, b: 2 } };
    const merged = mergePatch(base, {
      workflowPreferencesSet: { b: 3, c: 4 },
      workflowPreferencesDelete: ['a'],
    });
    expect(merged.workflowPreferences).toEqual({ b: 3, c: 4 });
  });

  it('null patch is a no-op', () => {
    const base = { ...freshModel(), expertiseDomains: ['ts'] };
    expect(mergePatch(base, null).expertiseDomains).toEqual(['ts']);
  });
});

describe('applyUpdate', () => {
  const updater: UserModelUpdater = async () => ({
    communicationStyle: 'terse',
    expertiseDomainsAdd: ['typescript'],
    riskTolerance: 'high',
    workflowPreferencesSet: { prefers_pr_reviews: true },
    activeProjectsAdd: ['open-hipp0'],
  });

  it('creates the row on first call and applies the patch', async () => {
    const row = await applyUpdate(db, 'u1', projectId, updater, {
      projectId,
      userId: 'u1',
      text: 'hi',
      toolCallsCount: 0,
    });
    expect(row.communicationStyle).toBe('terse');
    expect(row.expertiseDomains).toEqual(['typescript']);
    expect(row.riskTolerance).toBe('high');
    expect(row.interactionCount).toBe(1);
  });

  it('incrementally merges across calls', async () => {
    await applyUpdate(db, 'u1', projectId, updater, {
      projectId,
      userId: 'u1',
      text: 'hi',
      toolCallsCount: 0,
    });
    const after2 = await applyUpdate(
      db,
      'u1',
      projectId,
      async () => ({ expertiseDomainsAdd: ['rust'] }),
      { projectId, userId: 'u1', text: 'hi2', toolCallsCount: 0 },
    );
    expect(after2.expertiseDomains?.sort()).toEqual(['rust', 'typescript']);
    expect(after2.interactionCount).toBe(2);
  });

  it('bumps interactionCount even when updater returns null', async () => {
    await applyUpdate(db, 'u1', projectId, updater, {
      projectId,
      userId: 'u1',
      text: '',
      toolCallsCount: 0,
    });
    const after = await applyUpdate(db, 'u1', projectId, async () => null, {
      projectId,
      userId: 'u1',
      text: '',
      toolCallsCount: 0,
    });
    expect(after.interactionCount).toBe(2);
  });

  it('persists only one row per (userId, projectId)', async () => {
    await applyUpdate(db, 'u1', projectId, updater, {
      projectId,
      userId: 'u1',
      text: '',
      toolCallsCount: 0,
    });
    await applyUpdate(db, 'u1', projectId, updater, {
      projectId,
      userId: 'u1',
      text: '',
      toolCallsCount: 0,
    });
    const rows = await db.select().from(userModels).where(eq(userModels.userId, 'u1'));
    expect(rows).toHaveLength(1);
  });
});

describe('getUserModel', () => {
  it('returns null before first update', async () => {
    expect(await getUserModel(db, 'nobody', projectId)).toBeNull();
  });
});

describe('renderUserModelSnippet', () => {
  it('returns null for a blank model', () => {
    expect(renderUserModelSnippet(freshModel())).toBeNull();
  });
  it('surfaces style, expertise, risk, active projects', () => {
    const m = {
      ...freshModel(),
      communicationStyle: 'terse',
      expertiseDomains: ['ts', 'rust'],
      riskTolerance: 'high' as const,
      activeProjects: ['one', 'two'],
    };
    const out = renderUserModelSnippet(m)!;
    expect(out).toContain('Style: terse');
    expect(out).toContain('Expertise: ts, rust');
    expect(out).toContain('Risk tolerance: high');
    expect(out).toContain('Active projects: one, two');
  });
});
