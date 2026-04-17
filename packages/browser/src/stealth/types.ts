/**
 * Fingerprint v2 + behavior engine + proxy rotation contracts.
 *
 * Strategy: we ship a *descriptor* of the fingerprint to present (or
 * randomize) + an `addInitScript` generator that a Playwright context
 * can inject. No patched Chromium required; no new runtime deps in
 * G1-e. See docs/browser/stealth-research.md for the evaluation.
 */

export interface FingerprintDescriptor {
  /** Reported `navigator.userAgent`. */
  readonly userAgent: string;
  /** Reported `navigator.platform`. */
  readonly platform: 'Win32' | 'MacIntel' | 'Linux x86_64' | 'Linux armv81';
  /** Reported `navigator.languages`. */
  readonly languages: readonly string[];
  /** Reported `navigator.hardwareConcurrency`. */
  readonly hardwareConcurrency: number;
  /** Reported `navigator.deviceMemory` (GB). */
  readonly deviceMemory: number;
  /** Reported timezone (IANA). */
  readonly timezone: string;
  /** Reported `screen` { width, height, colorDepth }. */
  readonly screen: { readonly width: number; readonly height: number; readonly colorDepth: number };
  /** Canvas fingerprint mode. */
  readonly canvas: 'passthrough' | 'noise' | 'fixed';
  /** WebGL fingerprint mode. */
  readonly webgl: 'passthrough' | 'noise' | 'fixed';
  /** Audio fingerprint mode. */
  readonly audio: 'passthrough' | 'noise';
  /** If true, WebRTC IP leaks are blocked via stub `RTCPeerConnection`. */
  readonly blockWebRtcLeaks: boolean;
  /** If true, `navigator.webdriver` is deleted. */
  readonly hideWebdriver: boolean;
  /** Override `navigator.plugins` / `navigator.mimeTypes` to look like real Chrome. */
  readonly stubPlugins: boolean;
  /** Seed for deterministic noise (tests). */
  readonly seed?: string;
}

export interface FingerprintEntropyEstimate {
  /** 0..1 ratio; 1 = indistinguishable from a default Chrome install. */
  readonly score: number;
  /** Per-feature contribution. */
  readonly perFeature: Readonly<Record<string, number>>;
  /** Notes surfaced to the CLI / operator. */
  readonly notes: readonly string[];
}

// ─── Behavior engine ─────────────────────────────────────────────────────────

export interface MouseCurvePoint {
  readonly x: number;
  readonly y: number;
  readonly tMs: number;
}

export interface ReadingPauseInput {
  readonly chars: number;
  readonly wpm?: number; // default 250
}

// ─── Proxy rotation ─────────────────────────────────────────────────────────

export interface ProxyEntry {
  readonly id: string;
  readonly url: string; // e.g. 'http://user:pass@host:port'
  /** Optional tags for filtering (country, type=residential/datacenter). */
  readonly tags?: readonly string[];
}

export type ProxyRotationStrategy =
  | 'round-robin'
  | 'random'
  | 'per-host' // sticky per-host within a session
  | 'per-task';

export interface ProxyRotatorState {
  readonly lastId?: string;
  readonly nextIndex?: number;
  readonly byHost?: Readonly<Record<string, string>>;
}
