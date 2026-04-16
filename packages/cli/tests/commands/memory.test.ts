import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { db as memoryDb, recall as _recall } from '@openhipp0/memory';
import { runMemorySearch, runMemoryStats } from '../../src/commands/memory.js';
import { Hipp0CliError } from '../../src/types.js';

// Suppress unused import warning — recall is used transitively through the code under test.
void _recall;

let db: ReturnType<typeof memoryDb.createClient>;
let projectId: string;

beforeEach(async () => {
  db = memoryDb.createClient({ databaseUrl: ':memory:' });
  memoryDb.runMigrations(db);
  const [p] = await db.insert(memoryDb.projects).values({ name: 'Proj' }).returning();
  projectId = p!.id;
});
afterEach(() => memoryDb.closeClient(db));

describe('runMemoryStats', () => {
  it('reports zero counts on a fresh DB', async () => {
    const result = await runMemoryStats({ dbFactory: () => db, closeAfter: false });
    expect(result.exitCode).toBe(0);
    const { counts } = result.data as { counts: Record<string, number> };
    expect(counts['decisions']).toBe(0);
    expect(counts['session_history']).toBe(0);
    expect(counts['projects']).toBe(1); // seed
  });

  it('reflects row count after inserts', async () => {
    await db
      .insert(memoryDb.sessionHistory)
      .values({
        id: 's1',
        projectId,
        agentId: 'agent:a1',
        summary: 'test',
        fullText: 'hello world',
      })
      .run();
    const result = await runMemoryStats({ dbFactory: () => db, closeAfter: false });
    const { counts } = result.data as { counts: Record<string, number> };
    expect(counts['session_history']).toBe(1);
  });
});

describe('runMemorySearch', () => {
  it('returns empty result when nothing matches', async () => {
    const result = await runMemorySearch('nothing', {
      projectId,
      dbFactory: () => db,
      closeAfter: false,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout?.[0]).toMatch(/No session matches/);
  });

  it('finds session by FTS5 match', async () => {
    await db
      .insert(memoryDb.sessionHistory)
      .values({
        id: 's1',
        projectId,
        agentId: 'agent:a1',
        summary: 'deploy prod',
        fullText: 'deploying to production kubernetes cluster',
      })
      .run();
    const result = await runMemorySearch('kubernetes', {
      projectId,
      dbFactory: () => db,
      closeAfter: false,
    });
    expect(result.exitCode).toBe(0);
    const { hits } = result.data as { hits: { session: { id: string } }[] };
    expect(hits).toHaveLength(1);
    expect(hits[0]!.session.id).toBe('s1');
  });

  it('rejects empty query', async () => {
    await expect(
      runMemorySearch('   ', { projectId, dbFactory: () => db, closeAfter: false }),
    ).rejects.toBeInstanceOf(Hipp0CliError);
  });

  it('rejects missing project id', async () => {
    await expect(
      runMemorySearch('foo', { projectId: '', dbFactory: () => db, closeAfter: false }),
    ).rejects.toThrow(/--project/);
  });
});
