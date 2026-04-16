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

/**
 * Trust level on ingested content. Phase 21 (prompt-injection defense)
 * reads this to decide whether an item can promote into a decision or
 * fed back as instructions to the agent.
 *
 *   high       — authored inside a trusted system by an authenticated user
 *                (e.g. an internal Notion page in a restricted workspace).
 *   medium     — default for most internal-but-mutable systems (Linear,
 *                Confluence, GitHub PRs).
 *   low        — chat / collaborative content that may contain outside
 *                messages (Slack channels, Discord, email-to-ticket).
 *   untrusted  — feeds that explicitly include third-party / public input
 *                (public Slack community, email inbox, web scrape).
 *
 * Low + untrusted items are quarantined: they get stored for recall but
 * never auto-promote into decisions, never feed back into the agent's
 * system prompt.
 */
export type TrustLevel = 'high' | 'medium' | 'low' | 'untrusted';

export function defaultTrustFor(source: ConnectorSource): TrustLevel {
  switch (source) {
    case 'slack':
      return 'low';
    case 'notion':
    case 'linear':
    case 'github-pr':
    case 'confluence':
      return 'medium';
    case 'custom':
    default:
      return 'untrusted';
  }
}

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
  /**
   * Trust level for Phase 21 (prompt-injection defense). Optional — falls
   * back to `defaultTrustFor(source)` when omitted. Connector instances
   * can downgrade (e.g. a "public community Slack" connector sets
   * trust='untrusted') but should never upgrade defaults.
   */
  trust?: TrustLevel;
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
  extractFacts?(
    text: string,
    source: { url: string; kind: ConnectorSource; trust: TrustLevel },
  ): Promise<readonly string[]>;
  /** Create a decision record from a high-signal item. */
  createDecision?(input: {
    title: string;
    reasoning: string;
    tags?: readonly string[];
    sourceUrl: string;
    origin: ConnectorSource;
    trust: TrustLevel;
  }): Promise<{ id: string }>;
  /** Store a raw memory entry for future recall. */
  storeMemory?(
    text: string,
    opts: { tags?: readonly string[]; origin: ConnectorSource; trust: TrustLevel },
  ): Promise<void>;
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
  const trust = item.trust ?? defaultTrustFor(item.source);
  const quarantined = trust === 'low' || trust === 'untrusted';

  try {
    if (distillery.extractFacts) {
      const facts = await distillery.extractFacts(item.body, {
        url: item.sourceUrl,
        kind: item.source,
        trust,
      });
      if (facts.length > 0 && distillery.storeMemory) {
        for (const f of facts) {
          await distillery.storeMemory(f, {
            ...(item.tags !== undefined && { tags: item.tags }),
            origin: item.source,
            trust,
          });
        }
      }
    }
    // Quarantined content (low / untrusted) never becomes a decision.
    // It lands as memory with its trust tag preserved so Phase 21 can
    // gate recall accordingly.
    if (!quarantined && distillery.createDecision && looksDecisionBearing(item)) {
      await distillery.createDecision({
        title: item.title,
        reasoning: item.body,
        ...(item.tags !== undefined && { tags: item.tags }),
        sourceUrl: item.sourceUrl,
        origin: item.source,
        trust,
      });
    } else if (distillery.storeMemory) {
      await distillery.storeMemory(`${item.title}\n${item.body}`, {
        ...(item.tags !== undefined && { tags: item.tags }),
        origin: item.source,
        trust,
      });
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
