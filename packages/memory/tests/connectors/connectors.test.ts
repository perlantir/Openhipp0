import { describe, it, expect, vi } from 'vitest';
import {
  createMemoryDedupStore,
  defaultTrustFor,
  hashContent,
  ingestItem,
  looksDecisionBearing,
  type ConnectorItem,
  type DistilleryHooks,
  type SyncOptions,
  type SyncReport,
  type TrustLevel,
} from '../../src/connectors/types.js';
import { NotionConnector } from '../../src/connectors/notion.js';
import { LinearConnector } from '../../src/connectors/linear.js';
import { SlackConnector } from '../../src/connectors/slack.js';
import { GithubPrConnector } from '../../src/connectors/github-pr.js';
import { ConfluenceConnector } from '../../src/connectors/confluence.js';

function stubDistillery(): DistilleryHooks & {
  facts: string[];
  decisions: Array<{ title: string; sourceUrl: string; trust: TrustLevel }>;
  memories: Array<{ text: string; trust: TrustLevel }>;
} {
  const facts: string[] = [];
  const decisions: Array<{ title: string; sourceUrl: string; trust: TrustLevel }> = [];
  const memories: Array<{ text: string; trust: TrustLevel }> = [];
  return {
    facts,
    decisions,
    memories,
    async extractFacts(text) {
      return text.split('\n').filter((s) => s.startsWith('- '));
    },
    async createDecision(input) {
      decisions.push({ title: input.title, sourceUrl: input.sourceUrl, trust: input.trust });
      return { id: `d-${decisions.length}` };
    },
    async storeMemory(text, opts) {
      memories.push({ text, trust: opts.trust });
    },
  };
}

function syncOpts(dist: DistilleryHooks): SyncOptions {
  return { dedupStore: createMemoryDedupStore(), distillery: dist };
}

// ─── Dedup + ingest ──────────────────────────────────────────────────────

describe('ingestItem + dedup', () => {
  const item: ConnectorItem = {
    source: 'notion',
    sourceUrl: 'https://n/a',
    externalId: 'a',
    title: 'T',
    body: 'B',
    updatedAt: '2026-04-16T00:00:00Z',
    contentHash: hashContent('T', 'B'),
  };

  it('stores and dedupes on the second call', async () => {
    const dist = stubDistillery();
    const opts = syncOpts(dist);
    const report: SyncReport = {
      source: 'notion',
      fetched: 0,
      ingested: 0,
      skippedDuplicate: 0,
      errors: [],
    };
    await ingestItem(item, opts, report);
    await ingestItem(item, opts, report);
    expect(report.ingested).toBe(1);
    expect(report.skippedDuplicate).toBe(1);
  });

  it('treats changed content as a new item', async () => {
    const dist = stubDistillery();
    const opts = syncOpts(dist);
    const report: SyncReport = {
      source: 'notion',
      fetched: 0,
      ingested: 0,
      skippedDuplicate: 0,
      errors: [],
    };
    await ingestItem(item, opts, report);
    await ingestItem({ ...item, body: 'B2', contentHash: hashContent('T', 'B2') }, opts, report);
    expect(report.ingested).toBe(2);
  });

  it('looksDecisionBearing picks up ADR-ish phrasing', () => {
    expect(
      looksDecisionBearing({
        ...item,
        body: 'We decided to use Postgres because it supports RLS',
      }),
    ).toBe(true);
    expect(looksDecisionBearing({ ...item, body: 'hi there' })).toBe(false);
  });
});

// ─── Notion ──────────────────────────────────────────────────────────────

describe('NotionConnector', () => {
  function notionFetch(): typeof fetch {
    return vi.fn(async (input) => {
      const url = String(input);
      if (url.endsWith('/v1/search')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                id: 'page-1',
                url: 'https://www.notion.so/page-1',
                last_edited_time: '2026-04-16T00:00:00Z',
                properties: {
                  Name: { type: 'title', title: [{ plain_text: 'Deploy Strategy' }] },
                },
              },
            ],
            has_more: false,
          }),
          { status: 200 },
        );
      }
      if (url.includes('/blocks/page-1/children')) {
        return new Response(
          JSON.stringify({
            results: [
              {
                type: 'paragraph',
                paragraph: { rich_text: [{ plain_text: 'We decided to ship daily.' }] },
              },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
  }

  it('fetches pages + blocks and ingests them', async () => {
    const connector = new NotionConnector({ accessToken: 'tok', fetch: notionFetch() });
    const dist = stubDistillery();
    const report = await connector.sync(syncOpts(dist));
    expect(report.fetched).toBe(1);
    expect(report.ingested).toBe(1);
    // "decided" → decision-bearing → createDecision called.
    expect(dist.decisions).toHaveLength(1);
    expect(dist.decisions[0]!.title).toBe('Deploy Strategy');
  });

  it('stops when a 4xx response lands', async () => {
    const f = vi.fn(async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    const connector = new NotionConnector({ accessToken: 'x', fetch: f });
    const report = await connector.sync(syncOpts(stubDistillery()));
    expect(report.errors.length).toBeGreaterThan(0);
  });
});

// ─── Linear ──────────────────────────────────────────────────────────────

describe('LinearConnector', () => {
  it('sends GraphQL with team/state filter and ingests nodes', async () => {
    const f = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            issues: {
              nodes: [
                {
                  id: 'i1',
                  identifier: 'ENG-1',
                  title: 'Migrate to Postgres',
                  description: 'We decided on RLS.',
                  url: 'https://linear.app/x/ENG-1',
                  updatedAt: '2026-04-16T00:00:00Z',
                  state: { name: 'Done', type: 'completed' },
                  team: { id: 't1', key: 'ENG' },
                  creator: { name: 'Alice' },
                  comments: { nodes: [] },
                },
              ],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const connector = new LinearConnector({ apiKey: 'lin', fetch: f, teamIds: ['t1'] });
    const dist = stubDistillery();
    const report = await connector.sync(syncOpts(dist));
    expect(report.ingested).toBe(1);
    expect(dist.decisions).toHaveLength(1);
    const body = JSON.parse(String(f.mock.calls[0]![1]!.body));
    expect(body.variables.filter.team.id.in).toEqual(['t1']);
  });
});

// ─── Slack ───────────────────────────────────────────────────────────────

describe('SlackConnector', () => {
  it('backfills channel history and skips bot messages', async () => {
    const f = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('conversations.history')) {
        return new Response(
          JSON.stringify({
            ok: true,
            messages: [
              { ts: '1700000000.0001', user: 'U1', text: 'real user message' },
              { ts: '1700000001.0001', bot_id: 'B1', text: 'bot message' },
            ],
          }),
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const connector = new SlackConnector({
      botToken: 'xoxb',
      channelIds: ['C1'],
      fetch: f,
      workspaceDomain: 'acme.slack.com',
    });
    const report = await connector.sync(syncOpts(stubDistillery()));
    expect(report.fetched).toBe(1);
    expect(report.ingested).toBe(1);
  });
});

// ─── GitHub PR ───────────────────────────────────────────────────────────

describe('GithubPrConnector', () => {
  it('filters to merged PRs and pulls review comments', async () => {
    const f = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes('/pulls/1/comments')) {
        return new Response(
          JSON.stringify([
            { body: 'Looks good. We decided on retries.', user: { login: 'reviewer' } },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/pulls')) {
        return new Response(
          JSON.stringify([
            {
              number: 1,
              title: 'Switch to exponential backoff',
              body: '## Why\nBecause we decided on retries.',
              html_url: 'https://github.com/x/y/pull/1',
              updated_at: '2026-04-16T00:00:00Z',
              merged_at: '2026-04-16T01:00:00Z',
              state: 'closed',
              user: { login: 'author' },
            },
            {
              number: 2,
              title: 'draft',
              body: '',
              html_url: 'https://github.com/x/y/pull/2',
              updated_at: '2026-04-16T00:00:00Z',
              merged_at: null,
              state: 'closed',
            },
          ]),
          { status: 200 },
        );
      }
      return new Response('', { status: 404 });
    }) as unknown as typeof fetch;
    const connector = new GithubPrConnector({
      token: 'gh',
      owner: 'x',
      repo: 'y',
      fetch: f,
    });
    const dist = stubDistillery();
    const report = await connector.sync(syncOpts(dist));
    expect(report.ingested).toBe(1); // only merged PR
    expect(dist.decisions).toHaveLength(1); // decision-bearing
  });
});

// ─── Confluence ──────────────────────────────────────────────────────────

describe('ConfluenceConnector', () => {
  it('strips HTML from storage body before ingesting', async () => {
    const f = vi.fn(async () =>
      new Response(
        JSON.stringify({
          results: [
            {
              id: 'p1',
              title: 'ADR-001 Database',
              body: {
                storage: {
                  value:
                    '<p>We decided to use <strong>Postgres</strong> because of RLS.</p>',
                },
              },
              version: { when: '2026-04-16T00:00:00Z', by: { displayName: 'A' } },
              _links: { base: 'https://x.atlassian.net/wiki', webui: '/x/p1' },
            },
          ],
        }),
        { status: 200 },
      ),
    ) as unknown as typeof fetch;
    const connector = new ConfluenceConnector({
      baseUrl: 'https://x.atlassian.net',
      auth: { type: 'bearer', token: 't' },
      fetch: f,
    });
    const dist = stubDistillery();
    const report = await connector.sync(syncOpts(dist));
    expect(report.ingested).toBe(1);
    expect(dist.decisions[0]?.sourceUrl).toContain('/wiki/x/p1');
    // Stripped HTML — no angle brackets in the recorded memory text.
    expect(dist.memories.every((m) => !m.text.includes('<strong>'))).toBe(true);
  });
});

// ─── Trust tagging (Retro-B) ──────────────────────────────────────────────

describe('source tagging + quarantine', () => {
  const base: Omit<ConnectorItem, 'source' | 'trust' | 'contentHash'> = {
    sourceUrl: 'https://x/y',
    externalId: 'x',
    title: 'We decided to migrate to Postgres',
    body: 'Because RLS is a hard requirement.',
    updatedAt: '2026-04-16T00:00:00Z',
  };

  it('defaultTrustFor maps known sources correctly', () => {
    expect(defaultTrustFor('notion')).toBe('medium');
    expect(defaultTrustFor('linear')).toBe('medium');
    expect(defaultTrustFor('slack')).toBe('low');
    expect(defaultTrustFor('github-pr')).toBe('medium');
    expect(defaultTrustFor('confluence')).toBe('medium');
    expect(defaultTrustFor('custom')).toBe('untrusted');
  });

  it('medium-trust item promotes to a decision when text looks decision-bearing', async () => {
    const dist = stubDistillery();
    const opts: SyncOptions = { dedupStore: createMemoryDedupStore(), distillery: dist };
    const report: SyncReport = { source: 'notion', fetched: 0, ingested: 0, skippedDuplicate: 0, errors: [] };
    await ingestItem(
      { ...base, source: 'notion', contentHash: hashContent(base.title, base.body) },
      opts,
      report,
    );
    expect(dist.decisions).toHaveLength(1);
    expect(dist.decisions[0]?.trust).toBe('medium');
  });

  it('low-trust item (Slack default) is quarantined — stored but never a decision', async () => {
    const dist = stubDistillery();
    const opts: SyncOptions = { dedupStore: createMemoryDedupStore(), distillery: dist };
    const report: SyncReport = { source: 'slack', fetched: 0, ingested: 0, skippedDuplicate: 0, errors: [] };
    await ingestItem(
      { ...base, source: 'slack', contentHash: hashContent(base.title, base.body) },
      opts,
      report,
    );
    expect(dist.decisions).toHaveLength(0);
    expect(dist.memories).toHaveLength(1);
    expect(dist.memories[0]?.trust).toBe('low');
  });

  it('explicit trust=untrusted override wins over source default', async () => {
    const dist = stubDistillery();
    const opts: SyncOptions = { dedupStore: createMemoryDedupStore(), distillery: dist };
    const report: SyncReport = { source: 'notion', fetched: 0, ingested: 0, skippedDuplicate: 0, errors: [] };
    await ingestItem(
      {
        ...base,
        source: 'notion',
        trust: 'untrusted',
        contentHash: hashContent(base.title, base.body),
      },
      opts,
      report,
    );
    expect(dist.decisions).toHaveLength(0);
    expect(dist.memories[0]?.trust).toBe('untrusted');
  });

  it('passes trust through to extractFacts callers', async () => {
    const extracted: TrustLevel[] = [];
    const dist: DistilleryHooks = {
      async extractFacts(_text, src) {
        extracted.push(src.trust);
        return ['- one'];
      },
      async storeMemory() {
        // no-op — we just want the trust signal on extractFacts
      },
    };
    const opts: SyncOptions = { dedupStore: createMemoryDedupStore(), distillery: dist };
    const report: SyncReport = { source: 'slack', fetched: 0, ingested: 0, skippedDuplicate: 0, errors: [] };
    await ingestItem(
      { ...base, source: 'slack', contentHash: hashContent(base.title, base.body) },
      opts,
      report,
    );
    expect(extracted).toEqual(['low']);
  });
});
