/**
 * Linear connector — GraphQL API. Pulls issues + comments with filtering
 * by team/state, processes each through the distillery.
 */

import {
  hashContent,
  ingestItem,
  type Connector,
  type SyncOptions,
  type SyncReport,
} from './types.js';

const LINEAR_URL = 'https://api.linear.app/graphql';

export interface LinearConnectorOptions {
  apiKey: string;
  teamIds?: readonly string[];
  /** e.g. ['Done', 'Canceled'] — only pull resolved issues by default. */
  states?: readonly string[];
  fetch?: typeof fetch;
  baseUrl?: string;
}

const ISSUES_QUERY = `
  query Issues($first: Int!, $after: String, $filter: IssueFilter) {
    issues(first: $first, after: $after, filter: $filter) {
      nodes {
        id
        identifier
        title
        description
        url
        updatedAt
        state { name type }
        team { id key }
        creator { name email }
        comments { nodes { body user { name } updatedAt url } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
`;

interface LinearIssueNode {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url: string;
  updatedAt: string;
  state?: { name: string; type: string } | null;
  team?: { id: string; key: string } | null;
  creator?: { name?: string; email?: string } | null;
  comments?: { nodes?: Array<{ body: string; user?: { name?: string }; updatedAt: string; url?: string }> };
}

export class LinearConnector implements Connector {
  readonly source = 'linear' as const;

  constructor(private readonly opts: LinearConnectorOptions) {}

  async sync(opts: SyncOptions): Promise<SyncReport> {
    const report: SyncReport = {
      source: this.source,
      fetched: 0,
      ingested: 0,
      skippedDuplicate: 0,
      errors: [],
    };
    const fetcher = this.opts.fetch ?? fetch;
    const url = this.opts.baseUrl ?? LINEAR_URL;
    const limit = opts.limit ?? 500;

    let after: string | undefined;
    while (report.fetched < limit) {
      const filter: Record<string, unknown> = {};
      if (this.opts.teamIds) filter['team'] = { id: { in: this.opts.teamIds } };
      if (this.opts.states) filter['state'] = { name: { in: this.opts.states } };
      const body = {
        query: ISSUES_QUERY,
        variables: {
          first: Math.min(50, limit - report.fetched),
          after,
          filter: Object.keys(filter).length > 0 ? filter : undefined,
        },
      };
      let resp: Response;
      try {
        resp = await fetcher(url, {
          method: 'POST',
          headers: {
            authorization: this.opts.apiKey,
            'content-type': 'application/json',
          },
          body: JSON.stringify(body),
        });
      } catch (err) {
        report.errors.push({ error: err instanceof Error ? err.message : String(err) });
        if (opts.failFast) throw err;
        break;
      }
      if (!resp.ok) {
        report.errors.push({ error: `linear ${resp.status}` });
        if (opts.failFast) throw new Error(`linear ${resp.status}`);
        break;
      }
      const json = (await resp.json()) as {
        data?: {
          issues?: {
            nodes?: LinearIssueNode[];
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          };
        };
      };
      const nodes = json.data?.issues?.nodes ?? [];
      for (const node of nodes) {
        report.fetched += 1;
        const issueBody =
          (node.description ?? '') +
          '\n\n' +
          (node.comments?.nodes ?? [])
            .map((c) => `@${c.user?.name ?? 'unknown'}: ${c.body}`)
            .join('\n\n');
        await ingestItem(
          {
            source: 'linear',
            sourceUrl: node.url,
            externalId: node.id,
            title: `[${node.identifier}] ${node.title}`,
            body: issueBody,
            updatedAt: node.updatedAt,
            author: node.creator?.name ?? undefined,
            contentHash: hashContent(node.title, issueBody),
            tags: ['linear', ...(node.team?.key ? [node.team.key.toLowerCase()] : [])],
            metadata: {
              stateName: node.state?.name,
              stateType: node.state?.type,
            },
          },
          opts,
          report,
        );
      }
      const pageInfo = json.data?.issues?.pageInfo;
      if (!pageInfo?.hasNextPage || !pageInfo.endCursor) break;
      after = pageInfo.endCursor;
    }
    return report;
  }
}
