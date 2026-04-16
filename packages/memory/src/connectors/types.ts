/**
 * Shared types for Phase 16 connectors.
 *
 * Each connector pulls structured content from an external knowledge base
 * (Notion / Linear / Slack / GitHub PR / Confluence), normalizes it into a
 * `ConnectorItem`, dedupes on (source-url, content-hash), and pipes
 * successful items through the distillery callbacks to land as decisions
 * or memory entries in the graph.
 */

import crypto from 'node:crypto';

export type ConnectorSource = 'notion' | 'linear' | 'slack' | 'github-pr' | 'confluence' | 'custom';

export interface ConnectorItem {
  source: ConnectorSource;
  /** Canonical URL of the source page/issue/thread — used for dedup. */
  sourceUrl: string;
  /** External id (Notion page id, Linear issue id, Slack ts, etc.). */
  externalId: string;
  title: string;
  /** Plain-text body; the distillery processes this for facts + decisions. */
  body: string;
  /** ISO 8601 string — external system's last edited time. */
  updatedAt: string;
  /** Author / reporter / channel for provenance. */
  author?: string;
  tags?: readonly string[];
  /** Raw content hash over (title + body) for change-detection on re-sync. */
  contentHash: string;
  metadata?: Record<string, unknown>;
}

export function hashContent(title: string, body: string): string {
  return crypto.createHash('sha256').update(`${title}\n${body}`).digest('hex').slice(0, 16);
}

export interface ConnectorDedupStore {
  has(sourceUrl: string, contentHash: string): Promise<boolean>;
  remember(item: ConnectorItem): Promise<void>;
}

export function createMemoryDedupStore(): ConnectorDedupStore & { seen: Map<string, string> } {
  const seen = new Map<string, string>(); // url → hash
  return {
    seen,
    async has(url, hash) {
      return seen.get(url) === hash;
    },
    async remember(item) {
      seen.set(item.sourceUrl, item.contentHash);
    },
  };
}

/** Distillery callbacks — avoid importing the full learning module so the
 * connectors package depends only on core types. Wiring at the app layer. */
export interface DistilleryHooks {
  /** Extract factual statements from a block of text. Return empty to skip. */
  extractFacts?(text: string, source: { url: string; kind: ConnectorSource }): Promise<readonly string[]>;
  /** Create a decision record from a high-signal item. */
  createDecision?(input: {
    title: string;
    reasoning: string;
    tags?: readonly string[];
    sourceUrl: string;
  }): Promise<{ id: string }>;
  /** Store a raw memory entry for future recall. */
  storeMemory?(text: string, tags?: readonly string[]): Promise<void>;
}

export interface SyncOptions {
  dedupStore: ConnectorDedupStore;
  distillery: DistilleryHooks;
  /** Max items to process this run. */
  limit?: number;
  /** Stop on any transport error. Default: log + continue. */
  failFast?: boolean;
}

export interface SyncReport {
  source: ConnectorSource;
  fetched: number;
  ingested: number;
  skippedDuplicate: number;
  errors: Array<{ item?: string; error: string }>;
}

export interface Connector {
  readonly source: ConnectorSource;
  sync(opts: SyncOptions): Promise<SyncReport>;
}

// ─── Shared item → distillery pipeline ────────────────────────────────────

export async function ingestItem(
  item: ConnectorItem,
  { dedupStore, distillery }: SyncOptions,
  report: SyncReport,
): Promise<void> {
  if (await dedupStore.has(item.sourceUrl, item.contentHash)) {
    report.skippedDuplicate += 1;
    return;
  }
  try {
    if (distillery.extractFacts) {
      const facts = await distillery.extractFacts(item.body, {
        url: item.sourceUrl,
        kind: item.source,
      });
      if (facts.length > 0 && distillery.storeMemory) {
        for (const f of facts) {
          await distillery.storeMemory(f, item.tags);
        }
      }
    }
    // High-signal items (decision-bearing) are surfaced; others land as memory.
    if (distillery.createDecision && looksDecisionBearing(item)) {
      await distillery.createDecision({
        title: item.title,
        reasoning: item.body,
        ...(item.tags !== undefined && { tags: item.tags }),
        sourceUrl: item.sourceUrl,
      });
    } else if (distillery.storeMemory) {
      await distillery.storeMemory(`${item.title}\n${item.body}`, item.tags);
    }
    await dedupStore.remember(item);
    report.ingested += 1;
  } catch (err) {
    report.errors.push({
      item: item.sourceUrl,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const DECISION_SIGNALS = [
  /\bdecid(e|ed|ing)\b/i,
  /\bwe (chose|picked|selected|agreed)\b/i,
  /\b(ADR|architecture decision)\b/i,
  /\b(rfc|proposal)\b/i,
  /\bbecause\b.*\binstead of\b/i,
];

export function looksDecisionBearing(item: ConnectorItem): boolean {
  const text = `${item.title}\n${item.body}`;
  return DECISION_SIGNALS.some((rx) => rx.test(text));
}
