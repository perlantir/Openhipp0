/**
 * GitHub PR connector — pulls PR metadata + description + review comments
 * via /repos/:owner/:repo/pulls. Architectural decisions live in PR
 * descriptions (# Why + # Alternatives considered) and in review comments.
 */

import {
  hashContent,
  ingestItem,
  type Connector,
  type SyncOptions,
  type SyncReport,
} from './types.js';

const GITHUB_BASE = 'https://api.github.com';

export interface GithubPrConnectorOptions {
  token: string;
  owner: string;
  repo: string;
  /** 'merged' | 'closed' | 'all'. Default 'merged' — decisions land at merge. */
  state?: 'merged' | 'closed' | 'all';
  fetch?: typeof fetch;
  baseUrl?: string;
}

interface GhPr {
  number: number;
  title: string;
  body?: string;
  html_url: string;
  merged_at?: string | null;
  closed_at?: string | null;
  updated_at: string;
  state: string;
  user?: { login?: string };
}

interface GhReviewComment {
  body: string;
  user?: { login?: string };
  path?: string;
  html_url?: string;
}

export class GithubPrConnector implements Connector {
  readonly source = 'github-pr' as const;

  constructor(private readonly opts: GithubPrConnectorOptions) {}

  async sync(opts: SyncOptions): Promise<SyncReport> {
    const report: SyncReport = {
      source: this.source,
      fetched: 0,
      ingested: 0,
      skippedDuplicate: 0,
      errors: [],
    };
    const fetcher = this.opts.fetch ?? fetch;
    const base = this.opts.baseUrl ?? GITHUB_BASE;
    const limit = opts.limit ?? 200;
    const state = this.opts.state ?? 'merged';

    let page = 1;
    while (report.fetched < limit) {
      const url = new URL(`${base}/repos/${this.opts.owner}/${this.opts.repo}/pulls`);
      url.searchParams.set('state', state === 'merged' ? 'closed' : state);
      url.searchParams.set('sort', 'updated');
      url.searchParams.set('direction', 'desc');
      url.searchParams.set('per_page', String(Math.min(50, limit - report.fetched)));
      url.searchParams.set('page', String(page));
      let resp: Response;
      try {
        resp = await fetcher(url.toString(), {
          headers: {
            authorization: `Bearer ${this.opts.token}`,
            accept: 'application/vnd.github+json',
            'user-agent': 'openhipp0-connector',
          },
        });
      } catch (err) {
        report.errors.push({ error: err instanceof Error ? err.message : String(err) });
        if (opts.failFast) throw err;
        break;
      }
      if (!resp.ok) {
        report.errors.push({ error: `github ${resp.status}` });
        break;
      }
      const prs = (await resp.json()) as GhPr[];
      if (prs.length === 0) break;
      for (const pr of prs) {
        if (state === 'merged' && !pr.merged_at) continue;
        report.fetched += 1;
        const comments = await this.fetchReviewComments(fetcher, base, pr.number).catch(() => []);
        const body = [
          pr.body ?? '',
          ...comments.map(
            (c) => `[${c.path ?? 'pr'}] @${c.user?.login ?? 'unknown'}: ${c.body}`,
          ),
        ]
          .filter(Boolean)
          .join('\n\n');
        await ingestItem(
          {
            source: 'github-pr',
            sourceUrl: pr.html_url,
            externalId: `${this.opts.owner}/${this.opts.repo}#${pr.number}`,
            title: `PR #${pr.number}: ${pr.title}`,
            body,
            updatedAt: pr.updated_at,
            author: pr.user?.login,
            contentHash: hashContent(pr.title, body),
            tags: ['github-pr', `${this.opts.owner}/${this.opts.repo}`],
            metadata: { merged: !!pr.merged_at, state: pr.state },
          },
          opts,
          report,
        );
      }
      if (prs.length < 50) break;
      page += 1;
    }
    return report;
  }

  private async fetchReviewComments(
    fetcher: typeof fetch,
    base: string,
    prNumber: number,
  ): Promise<GhReviewComment[]> {
    const url = `${base}/repos/${this.opts.owner}/${this.opts.repo}/pulls/${prNumber}/comments?per_page=100`;
    const resp = await fetcher(url, {
      headers: {
        authorization: `Bearer ${this.opts.token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'openhipp0-connector',
      },
    });
    if (!resp.ok) return [];
    return (await resp.json()) as GhReviewComment[];
  }
}
