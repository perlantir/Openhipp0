/**
 * Page snapshot contracts.
 *
 * A snapshot is the union of (a) a11y tree + DOM + screenshot (visible state),
 * (b) network + console (temporal activity since last snapshot), (c) cookies
 * (persistent state), and (d) user-supplied metadata (profile id, session id,
 * label). Diffs compare two snapshots and emit structural change entries.
 */

import type { browser } from '@openhipp0/core';

export const SNAPSHOT_SCHEMA_VERSION = 1 as const;

export type SnapshotId = string & { readonly __brand: 'SnapshotId' };
export type SessionId = string & { readonly __brand: 'SessionId' };

/** Subset of a Chrome DevTools Protocol Network.requestWillBeSent / responseReceived. */
export interface NetworkEntry {
  readonly requestId: string;
  readonly method: string;
  readonly url: string;
  /** Response status; 0 if the request failed or is still pending. */
  readonly status: number;
  readonly type?: string; // e.g. 'xhr' | 'fetch' | 'document' | 'script' | 'stylesheet' | 'image'
  readonly startedAt: string; // ISO
  readonly endedAt?: string;
  readonly requestHeaders?: Readonly<Record<string, string>>;
  readonly responseHeaders?: Readonly<Record<string, string>>;
  readonly requestBodyHash?: string; // sha-256 of body, if any
  readonly responseBodyBytes?: number;
}

export interface ConsoleEntry {
  readonly level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  readonly text: string;
  readonly takenAt: string;
  readonly source?: string; // "scriptUrl:line:col"
}

export interface CookieEntry {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires?: number; // epoch seconds
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: 'Strict' | 'Lax' | 'None';
}

/**
 * Serialized DOM. When `contentGz` is set, the real DOM is gzipped JSON of
 * `{ html: string }`. When `refPrevId` is set, this snapshot re-uses the DOM
 * of snapshot `refPrevId` (content-dedup). Exactly one must be populated.
 */
export interface DomPayload {
  readonly hash: string; // sha-256 of raw HTML
  readonly contentGzB64?: string;
  readonly refPrevId?: SnapshotId;
}

/** Base64 PNG; dedupe via `refPrevId` when identical to previous snapshot. */
export interface ScreenshotPayload {
  readonly hash: string;
  readonly pngB64?: string;
  readonly refPrevId?: SnapshotId;
}

export interface Snapshot {
  readonly version: typeof SNAPSHOT_SCHEMA_VERSION;
  readonly id: SnapshotId;
  readonly sessionId: SessionId;
  readonly takenAt: string; // ISO UTC
  readonly url: string;
  readonly title: string;
  readonly ax: browser.AxNode | null;
  readonly dom: DomPayload;
  readonly screenshot: ScreenshotPayload;
  /** Since previous snapshot in the same session. First snapshot: full buffer. */
  readonly network: readonly NetworkEntry[];
  readonly console: readonly ConsoleEntry[];
  readonly cookies: readonly CookieEntry[];
  readonly label?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface CapturePageInput {
  readonly page: browser.BrowserPage;
  /** Required — supplied by caller (from a CDP session or mock). */
  readonly context: browser.BrowserContext;
  readonly sessionId: SessionId;
  readonly network?: readonly NetworkEntry[];
  readonly console?: readonly ConsoleEntry[];
  readonly label?: string;
  readonly metadata?: Record<string, unknown>;
  /** When set, enables dedup against the previous snapshot. */
  readonly previous?: Snapshot;
}

// ─── Diff ────────────────────────────────────────────────────────────────────

export type DiffKind =
  | 'url-changed'
  | 'title-changed'
  | 'dom-changed'
  | 'screenshot-changed'
  | 'ax-added'
  | 'ax-removed'
  | 'ax-changed'
  | 'network-added'
  | 'console-added'
  | 'cookie-added'
  | 'cookie-changed'
  | 'cookie-removed';

export interface DiffEntry {
  readonly kind: DiffKind;
  readonly path?: string; // `ax[3].name`, `cookies[session]`, etc.
  readonly prev?: unknown;
  readonly curr?: unknown;
  readonly message: string;
}

export interface SnapshotDiff {
  readonly prevId: SnapshotId;
  readonly currId: SnapshotId;
  readonly entries: readonly DiffEntry[];
}

// ─── Store ───────────────────────────────────────────────────────────────────

export interface RetentionPolicy {
  /** Max snapshots per session. Oldest above this are pruned on write. */
  readonly maxPerSession?: number;
  /** Max total bytes across all sessions. Oldest are pruned on write. */
  readonly maxTotalBytes?: number;
  /** Max age in ms. Older are pruned on write. */
  readonly maxAgeMs?: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  maxPerSession: 100,
  maxTotalBytes: 1 * 1024 * 1024 * 1024, // 1 GB
  maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
};

export interface ReplayTarget {
  readonly context: browser.BrowserContext;
  readonly page: browser.BrowserPage;
}

export interface ReplayOptions {
  /** Restore cookies via BrowserContext.addCookies (default true). */
  readonly restoreCookies?: boolean;
  /** Navigate page to snapshot URL (default true). */
  readonly navigate?: boolean;
  /** Wait timeout for readiness heuristics (default 10_000 ms). */
  readonly waitTimeoutMs?: number;
}

export interface ReplayResult {
  readonly ok: boolean;
  readonly actions: readonly string[];
  readonly warnings: readonly string[];
}
