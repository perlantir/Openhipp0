/**
 * Confluence / generic-wiki connector — supports Atlassian Cloud (/wiki/api/v2)
 * + Atlassian Server (/rest/api). Pages, blog posts, and ADRs all flow through
 * the same ingest path.
 */

import {
  hashContent,
  ingestItem,
  type Connector,
  type SyncOptions,
  type SyncReport,
} from './types.js';

export interface ConfluenceConnectorOptions {
  /** e.g. https://yourorg.atlassian.net/wiki or https://confluence.example.com */
  baseUrl: string;
  /** Basic auth: "email:api_token" base64-encoded OR a bearer PAT. */
  auth: { type: 'basic'; encoded: string } | { type: 'bearer'; token: string };
  /** 'cloud' uses /wiki/api/v2; 'server' uses /rest/api. Default 'cloud'. */
  flavor?: 'cloud' | 'server';
  spaceKeys?: readonly string[];
  fetch?: typeof fetch;
}

interface CfPage {
  id: string;
  title: string;
  body?: { storage?: { value?: string }; view?: { value?: string }; atlas_doc_format?: { value?: string } };
  version?: { when?: string; by?: { displayName?: string } };
  _links?: { webui?: string; base?: string };
  spaceId?: string;
}

export class ConfluenceConnector implements Connector {
  readonly source = 'confluence' as const;

  constructor(private readonly opts: ConfluenceConnectorOptions) {}

  async sync(opts: SyncOptions): Promise<SyncReport> {
    const report: SyncReport = {
      source: this.source,
      fetched: 0,
      ingested: 0,
      skippedDuplicate: 0,
      errors: [],
    };
    const fetcher = this.opts.fetch ?? fetch;
    const flavor = this.opts.flavor ?? 'cloud';
    const limit = opts.limit ?? 200;
    const auth =
      this.opts.auth.type === 'basic'
        ? `Basic ${this.opts.auth.encoded}`
        : `Bearer ${this.opts.auth.token}`;

    let cursor: string | undefined;
    while (report.fetched < limit) {
      const path =
        flavor === 'cloud'
          ? `/wiki/api/v2/pages?limit=${Math.min(100, limit - report.fetched)}&body-format=storage${
              cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''
            }`
          : `/rest/api/content?expand=body.storage,version,space&type=page&start=${report.fetched}&limit=${
              Math.min(50, limit - report.fetched)
            }`;
      let resp: Response;
      try {
        resp = await fetcher(`${this.opts.baseUrl}${path}`, {
          headers: { authorization: auth, accept: 'application/json' },
        });
      } catch (err) {
        report.errors.push({ error: err instanceof Error ? err.message : String(err) });
        if (opts.failFast) throw err;
        break;
      }
      if (!resp.ok) {
        report.errors.push({ error: `confluence ${resp.status}` });
        break;
      }
      const json = (await resp.json()) as {
        results?: CfPage[];
        _links?: { next?: string };
      };
      const pages = json.results ?? [];
      if (pages.length === 0) break;
      for (const page of pages) {
        report.fetched += 1;
        if (this.opts.spaceKeys && flavor === 'server') {
          const space = (page as unknown as { space?: { key?: string } }).space?.key;
          if (space && !this.opts.spaceKeys.includes(space)) continue;
        }
        const webUrl =
          page._links?.webui && page._links?.base
            ? `${page._links.base}${page._links.webui}`
            : `${this.opts.baseUrl}/pages/${page.id}`;
        const storage = page.body?.storage?.value ?? page.body?.view?.value ?? page.body?.atlas_doc_format?.value ?? '';
        const body = stripHtml(storage);
        await ingestItem(
          {
            source: 'confluence',
            sourceUrl: webUrl,
            externalId: page.id,
            title: page.title,
            body,
            updatedAt: page.version?.when ?? new Date(0).toISOString(),
            author: page.version?.by?.displayName,
            contentHash: hashContent(page.title, body),
            tags: ['confluence'],
          },
          opts,
          report,
        );
      }
      // Pagination
      if (flavor === 'cloud') {
        const next = json._links?.next;
        if (!next) break;
        const nextCursor = extractCursor(next);
        if (!nextCursor) break;
        cursor = nextCursor;
      } else {
        if (pages.length < 50) break;
      }
    }
    return report;
  }
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractCursor(next: string): string | null {
  const m = /[?&]cursor=([^&]+)/.exec(next);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}
