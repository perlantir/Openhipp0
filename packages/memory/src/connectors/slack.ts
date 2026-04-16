/**
 * Slack connector — channel backfill via conversations.history + threaded
 * replies via conversations.replies. Decision extraction runs over the
 * concatenated thread body.
 */

import {
  hashContent,
  ingestItem,
  type Connector,
  type SyncOptions,
  type SyncReport,
} from './types.js';

const SLACK_BASE = 'https://slack.com/api';

export interface SlackConnectorOptions {
  botToken: string;
  /** Channels to backfill. */
  channelIds: readonly string[];
  /** Unix seconds — pull messages newer than this. Default: 30d ago. */
  oldest?: number;
  fetch?: typeof fetch;
  baseUrl?: string;
  workspaceDomain?: string;
}

interface SlackMessage {
  ts: string;
  user?: string;
  bot_id?: string;
  text: string;
  thread_ts?: string;
  reply_count?: number;
  subtype?: string;
}

export class SlackConnector implements Connector {
  readonly source = 'slack' as const;

  constructor(private readonly opts: SlackConnectorOptions) {}

  async sync(opts: SyncOptions): Promise<SyncReport> {
    const report: SyncReport = {
      source: this.source,
      fetched: 0,
      ingested: 0,
      skippedDuplicate: 0,
      errors: [],
    };
    const fetcher = this.opts.fetch ?? fetch;
    const base = this.opts.baseUrl ?? SLACK_BASE;
    const limit = opts.limit ?? 500;
    const oldest = this.opts.oldest ?? Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;
    const workspaceDomain = this.opts.workspaceDomain ?? 'slack.com';

    for (const channelId of this.opts.channelIds) {
      let cursor: string | undefined;
      while (report.fetched < limit) {
        const url = new URL(`${base}/conversations.history`);
        url.searchParams.set('channel', channelId);
        url.searchParams.set('limit', String(Math.min(200, limit - report.fetched)));
        url.searchParams.set('oldest', String(oldest));
        if (cursor) url.searchParams.set('cursor', cursor);
        let resp: Response;
        try {
          resp = await fetcher(url.toString(), {
            headers: { authorization: `Bearer ${this.opts.botToken}` },
          });
        } catch (err) {
          report.errors.push({ error: err instanceof Error ? err.message : String(err) });
          if (opts.failFast) throw err;
          break;
        }
        if (!resp.ok) {
          report.errors.push({ error: `slack ${resp.status}` });
          break;
        }
        const json = (await resp.json()) as {
          ok?: boolean;
          error?: string;
          messages?: SlackMessage[];
          response_metadata?: { next_cursor?: string };
        };
        if (!json.ok) {
          report.errors.push({ error: `slack error: ${json.error}` });
          break;
        }
        for (const msg of json.messages ?? []) {
          if (msg.bot_id || msg.subtype) continue;
          report.fetched += 1;
          const threadBody = msg.reply_count
            ? await this.fetchThread(fetcher, base, channelId, msg.ts)
            : '';
          const body = threadBody || msg.text;
          const sourceUrl = `https://${workspaceDomain}/archives/${channelId}/p${msg.ts.replace('.', '')}`;
          await ingestItem(
            {
              source: 'slack',
              sourceUrl,
              externalId: `${channelId}:${msg.ts}`,
              title: msg.text.slice(0, 80),
              body,
              updatedAt: new Date(Number(msg.ts.split('.')[0]) * 1000).toISOString(),
              author: msg.user,
              contentHash: hashContent(msg.text, body),
              tags: ['slack', channelId],
            },
            opts,
            report,
          );
        }
        cursor = json.response_metadata?.next_cursor;
        if (!cursor) break;
      }
    }
    return report;
  }

  private async fetchThread(
    fetcher: typeof fetch,
    base: string,
    channel: string,
    thread_ts: string,
  ): Promise<string> {
    const url = new URL(`${base}/conversations.replies`);
    url.searchParams.set('channel', channel);
    url.searchParams.set('ts', thread_ts);
    url.searchParams.set('limit', '200');
    try {
      const resp = await fetcher(url.toString(), {
        headers: { authorization: `Bearer ${this.opts.botToken}` },
      });
      if (!resp.ok) return '';
      const json = (await resp.json()) as { messages?: SlackMessage[] };
      return (json.messages ?? []).map((m) => `@${m.user ?? 'bot'}: ${m.text}`).join('\n');
    } catch {
      return '';
    }
  }
}
