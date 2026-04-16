/**
 * Notion connector — OAuth2, paginates pages via /v1/search + /v1/pages/{id}
 * + /v1/blocks/{id}/children.
 *
 * Production wires an access token from @openhipp0/core auth; tests inject
 * a fake `fetch` that returns canned Notion API payloads.
 */

import {
  hashContent,
  ingestItem,
  type Connector,
  type ConnectorItem,
  type SyncOptions,
  type SyncReport,
} from './types.js';

const NOTION_BASE = 'https://api.notion.com';
const NOTION_VERSION = '2022-06-28';

export interface NotionConnectorOptions {
  accessToken: string;
  /** Optional filter: only sync pages from these database ids. */
  databaseIds?: readonly string[];
  /** Injectable for tests. */
  fetch?: typeof fetch;
  baseUrl?: string;
}

export class NotionConnector implements Connector {
  readonly source = 'notion' as const;

  constructor(private readonly opts: NotionConnectorOptions) {}

  async sync(opts: SyncOptions): Promise<SyncReport> {
    const report: SyncReport = {
      source: this.source,
      fetched: 0,
      ingested: 0,
      skippedDuplicate: 0,
      errors: [],
    };
    const fetcher = this.opts.fetch ?? fetch;
    const base = this.opts.baseUrl ?? NOTION_BASE;
    const limit = opts.limit ?? 200;

    let cursor: string | undefined;
    while (true) {
      if (report.fetched >= limit) break;
      const body: Record<string, unknown> = { page_size: Math.min(100, limit - report.fetched) };
      if (cursor) body['start_cursor'] = cursor;
      if (this.opts.databaseIds) {
        body['filter'] = { value: 'page', property: 'object' };
      }
      let resp: Response;
      try {
        resp = await fetcher(`${base}/v1/search`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${this.opts.accessToken}`,
            'content-type': 'application/json',
            'notion-version': NOTION_VERSION,
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        report.errors.push({ error: err instanceof Error ? err.message : String(err) });
        if (opts.failFast) throw err;
        break;
      }
      if (!resp.ok) {
        report.errors.push({ error: `notion ${resp.status}` });
        if (opts.failFast) throw new Error(`notion ${resp.status}`);
        break;
      }
      const json = (await resp.json()) as {
        results?: Array<Record<string, unknown>>;
        next_cursor?: string | null;
        has_more?: boolean;
      };
      for (const raw of json.results ?? []) {
        report.fetched += 1;
        const item = await this.normalizePage(raw, fetcher, base);
        if (!item) continue;
        if (this.opts.databaseIds) {
          const parent = (raw['parent'] as Record<string, unknown> | undefined) ?? {};
          const dbId = parent['database_id'] as string | undefined;
          if (!dbId || !this.opts.databaseIds.includes(dbId)) continue;
        }
        await ingestItem(item, opts, report);
      }
      if (!json.has_more || !json.next_cursor) break;
      cursor = json.next_cursor;
    }
    return report;
  }

  private async normalizePage(
    raw: Record<string, unknown>,
    fetcher: typeof fetch,
    base: string,
  ): Promise<ConnectorItem | null> {
    const id = raw['id'] as string | undefined;
    if (!id) return null;
    const url = (raw['url'] as string | undefined) ?? `https://www.notion.so/${id.replace(/-/g, '')}`;
    const props = (raw['properties'] as Record<string, unknown>) ?? {};
    const title = extractTitle(props) ?? 'Untitled';

    // Fetch first N blocks for the page body.
    let body = '';
    try {
      const blocksResp = await fetcher(
        `${base}/v1/blocks/${id}/children?page_size=50`,
        {
          headers: {
            authorization: `Bearer ${this.opts.accessToken}`,
            'notion-version': NOTION_VERSION,
          },
        },
      );
      if (blocksResp.ok) {
        const blocks = (await blocksResp.json()) as { results?: Array<Record<string, unknown>> };
        body = (blocks.results ?? []).map(blockToText).filter(Boolean).join('\n');
      }
    } catch {
      // body stays empty; we still record the title.
    }

    const lastEdited = (raw['last_edited_time'] as string | undefined) ?? new Date(0).toISOString();
    return {
      source: 'notion',
      sourceUrl: url,
      externalId: id,
      title,
      body,
      updatedAt: lastEdited,
      contentHash: hashContent(title, body),
      tags: ['notion'],
    };
  }
}

function extractTitle(properties: Record<string, unknown>): string | null {
  for (const value of Object.values(properties)) {
    if (value && typeof value === 'object') {
      const v = value as Record<string, unknown>;
      if (v['type'] === 'title' && Array.isArray(v['title'])) {
        return (v['title'] as Array<{ plain_text?: string }>).map((t) => t.plain_text ?? '').join('');
      }
    }
  }
  return null;
}

function blockToText(block: Record<string, unknown>): string {
  const type = block['type'] as string | undefined;
  if (!type) return '';
  const payload = block[type] as Record<string, unknown> | undefined;
  if (!payload) return '';
  if (Array.isArray(payload['rich_text'])) {
    return (payload['rich_text'] as Array<{ plain_text?: string }>).map((r) => r.plain_text ?? '').join('');
  }
  return '';
}
