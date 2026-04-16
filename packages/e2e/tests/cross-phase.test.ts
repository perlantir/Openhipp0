/**
 * Phase 17 cross-phase e2e — sanity-checks that Phase 11–16 features wire
 * together end-to-end. Each scenario uses the fake LLM + in-memory fakes so
 * tests stay deterministic without network access.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import {
  MediaEngine,
  LocalVisionStub,
  type TranscriptionProvider,
} from '@openhipp0/core';
import { withMediaEnrichment, type IncomingMessage } from '@openhipp0/bridge';
import {
  runMigrateOpenClaw,
} from '@openhipp0/cli';
import {
  createMemoryDedupStore,
  ingestItem,
  hashContent,
  type DistilleryHooks,
  type SyncReport,
} from '@openhipp0/memory';
import {
  toJsonl,
  toAtropos,
  type Trajectory,
  type TrajectoryMessage,
} from '@openhipp0/core';

function fakeWhisper(text: string): TranscriptionProvider {
  return { name: 'fake', async transcribe() { return { text }; } };
}

describe('voice → bridge enrichment → agent text', () => {
  it('telegrammed voice message is transcribed into IncomingMessage.text', async () => {
    const engine = new MediaEngine({
      transcription: [fakeWhisper('play some jazz')],
      vision: [new LocalVisionStub()],
    });
    const agentReceived: IncomingMessage[] = [];
    const handler = withMediaEnrichment(
      async (msg) => {
        agentReceived.push(msg);
      },
      {
        engine,
        async fetchAttachment() {
          return new Uint8Array([0x4f, 0x67, 0x67, 0x53]); // OggS header bytes
        },
      },
    );
    await handler({
      platform: 'telegram',
      id: 'msg-1',
      channel: { id: 'chan', isDM: true },
      user: { id: 'u1', name: 'User' },
      text: '',
      attachments: [{ filename: 'voice.ogg', contentType: 'audio/ogg', url: 'tg://file/123' }],
      timestamp: Date.now(),
    });
    expect(agentReceived).toHaveLength(1);
    expect(agentReceived[0]!.text).toContain('play some jazz');
  });
});

describe('migration → usage', () => {
  it('after OpenClaw migration, ingest callback received the memory entries', async () => {
    const ingestedEntries: string[] = [];
    const fs = createMemFs({
      '/src/SOUL.md': 'I am a helpful agent.',
      '/src/MEMORY.md': '## users prefer terse responses\n\n## prefer postgres over mysql',
    });
    const result = await runMigrateOpenClaw({
      source: '/src',
      destDir: '/dest',
      dryRun: false,
      preset: 'user-data',
      fs,
      onIngestMemory: async (entries) => {
        ingestedEntries.push(...entries);
      },
    });
    expect(result.exitCode).toBe(0);
    expect(ingestedEntries.length).toBeGreaterThan(0);
    // Subsequent usage: the imported persona is on disk.
    expect(await fs.readFile('/dest/soul.md')).toBe('I am a helpful agent.');
  });
});

describe('connector → memory → trajectory export', () => {
  it('decision-bearing item lands as a decision + gets included in trajectory', async () => {
    const decisions: string[] = [];
    const dist: DistilleryHooks = {
      async createDecision(input) {
        decisions.push(input.title);
        return { id: `d-${decisions.length}` };
      },
      async storeMemory() {},
    };
    const report: SyncReport = {
      source: 'notion',
      fetched: 0,
      ingested: 0,
      skippedDuplicate: 0,
      errors: [],
    };
    await ingestItem(
      {
        source: 'notion',
        sourceUrl: 'https://n/a',
        externalId: 'a',
        title: 'Adopt Postgres',
        body: 'We decided to use Postgres because of RLS.',
        updatedAt: '2026-04-16T00:00:00Z',
        contentHash: hashContent('Adopt Postgres', 'decided postgres'),
      },
      { dedupStore: createMemoryDedupStore(), distillery: dist },
      report,
    );
    expect(decisions).toEqual(['Adopt Postgres']);

    // Bundle a trajectory that cites the new decision.
    const messages: TrajectoryMessage[] = [
      { role: 'system', content: 'active decision: Adopt Postgres' },
      { role: 'user', content: 'which DB should I use?' },
      { role: 'assistant', content: 'Postgres, per the Adopt Postgres decision.' },
    ];
    const trajectory: Trajectory = {
      id: 't1',
      agent: { id: 'a', name: 'Writer' },
      projectId: 'p',
      messages,
      decisionsActive: [{ id: 'd-1', title: 'Adopt Postgres', activeAtTurn: 0 }],
      skillsLoaded: [],
      outcome: 'success',
      startedAt: new Date(0).toISOString(),
      completedAt: new Date(1).toISOString(),
    };
    const jsonl = toJsonl([trajectory]);
    expect(jsonl).toContain('Adopt Postgres');
    const atropos = toAtropos(trajectory);
    expect(atropos.total_reward).toBe(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Minimal MigrationFs implementation — duplicated here to avoid importing
// internal test helpers.
// ──────────────────────────────────────────────────────────────────────────

function createMemFs(seed: Record<string, string | Uint8Array>) {
  const { dirname } = path;
  const store = new Map<string, string | Uint8Array>(Object.entries(seed));
  const dirs = new Set<string>();
  for (const k of store.keys()) {
    let p = dirname(k);
    while (p && p !== '/' && p !== '.') {
      dirs.add(p);
      p = dirname(p);
    }
  }
  return {
    async exists(p: string) {
      return store.has(p) || dirs.has(p);
    },
    async readFile(p: string) {
      const v = store.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return typeof v === 'string' ? v : Buffer.from(v).toString('utf8');
    },
    async readBinaryFile(p: string) {
      const v = store.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return typeof v === 'string' ? new TextEncoder().encode(v) : v;
    },
    async writeFile(p: string, content: string | Uint8Array) {
      store.set(p, content);
      let cur = dirname(p);
      while (cur && cur !== '/' && cur !== '.') {
        dirs.add(cur);
        cur = dirname(cur);
      }
    },
    async mkdir(p: string) {
      dirs.add(p);
    },
    async readdir(p: string) {
      const prefix = p.endsWith('/') ? p : `${p}/`;
      const set = new Set<string>();
      for (const k of store.keys()) {
        if (k.startsWith(prefix)) set.add(k.slice(prefix.length).split('/')[0]!);
      }
      for (const d of dirs) {
        if (d.startsWith(prefix)) set.add(d.slice(prefix.length).split('/')[0]!);
      }
      return [...set];
    },
    async stat(p: string) {
      if (store.has(p)) {
        const v = store.get(p)!;
        return { isDirectory: false, size: typeof v === 'string' ? v.length : v.length };
      }
      if (dirs.has(p)) return { isDirectory: true, size: 0 };
      throw new Error(`ENOENT ${p}`);
    },
  };
}
