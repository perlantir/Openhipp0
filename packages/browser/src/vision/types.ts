/**
 * Vision subsystem — NL element location + screenshot reasoning. The
 * actual multimodal LLM call lives in `@openhipp0/core/llm`; this
 * module exposes interfaces that delegate to a caller-supplied
 * `VisionClient`.
 */

import type { browser } from '@openhipp0/core';

export interface VisionClient {
  /**
   * Ask a vision model to return a stable element ref for the described
   * target. Returns null when no confident match.
   */
  locate(input: {
    description: string;
    screenshotPng: Buffer;
    ax: browser.AxNode | null;
  }): Promise<{ ref: string | null; reasoning?: string }>;

  /**
   * Free-form reasoning about a screenshot — used for canvas-rendered
   * apps (Figma, Sheets) and PDFs-in-browser. Returns markdown prose.
   */
  reason(input: { prompt: string; screenshotPng: Buffer }): Promise<string>;
}

export interface LocateOptions {
  readonly description: string;
  /** Timeout in ms (default 15_000). */
  readonly timeoutMs?: number;
  /** If provided, the locator checks this ref first before asking vision. */
  readonly preferRef?: string;
}

export interface LocateResult {
  readonly ref: string | null;
  readonly reasoning?: string;
  readonly usedPath: 'prefer' | 'vision' | 'none';
  readonly durationMs: number;
}
