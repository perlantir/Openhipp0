/**
 * Multi-tab orchestrator — opens N pages from a shared `BrowserContext`,
 * runs a per-tab task in parallel, collects results. Per-host rate limits
 * throttle concurrent navigations against the same origin.
 *
 * Tab groups: logical grouping of related tabs (just string labels today;
 * the orchestrator exposes them for introspection + aggregation).
 */

import type { browser } from '@openhipp0/core';

import { CrossTabState } from './cross-tab-state.js';

export interface TabSpec<R> {
  readonly id: string;
  readonly url: string;
  readonly group?: string;
  readonly task: (page: browser.BrowserPage, state: CrossTabState) => Promise<R>;
}

export interface TabResult<R> {
  readonly id: string;
  readonly group?: string;
  readonly ok: boolean;
  readonly value?: R;
  readonly error?: string;
  readonly durationMs: number;
}

export interface OrchestratorOptions {
  readonly context: browser.BrowserContext;
  /** Max concurrent tabs (default 5). */
  readonly maxConcurrency?: number;
  /** Min delay between navigations to the same host (default 500 ms). */
  readonly perHostDelayMs?: number;
  readonly state?: CrossTabState;
}

export interface OrchestratorResult<R> {
  readonly results: readonly TabResult<R>[];
  readonly state: Readonly<Record<string, unknown>>;
  readonly perGroup: Readonly<Record<string, readonly TabResult<R>[]>>;
}

export class MultiTabOrchestrator {
  readonly #context: browser.BrowserContext;
  readonly #maxConcurrency: number;
  readonly #perHostDelay: number;
  readonly #state: CrossTabState;
  readonly #hostLastStart = new Map<string, number>();

  constructor(opts: OrchestratorOptions) {
    this.#context = opts.context;
    this.#maxConcurrency = Math.max(1, opts.maxConcurrency ?? 5);
    this.#perHostDelay = opts.perHostDelayMs ?? 500;
    this.#state = opts.state ?? new CrossTabState();
  }

  get state(): CrossTabState {
    return this.#state;
  }

  async runAll<R>(tabs: readonly TabSpec<R>[]): Promise<OrchestratorResult<R>> {
    const queue = [...tabs];
    const results: TabResult<R>[] = [];
    const running: Promise<void>[] = [];

    const next = async (): Promise<void> => {
      while (queue.length > 0) {
        const tab = queue.shift();
        if (!tab) break;
        const res = await this.#runOne(tab);
        results.push(res);
      }
    };

    for (let i = 0; i < this.#maxConcurrency; i++) running.push(next());
    await Promise.all(running);

    const perGroup: Record<string, TabResult<R>[]> = {};
    for (const r of results) {
      const key = r.group ?? '';
      (perGroup[key] ??= []).push(r);
    }

    return { results, state: this.#state.snapshot(), perGroup };
  }

  async #runOne<R>(tab: TabSpec<R>): Promise<TabResult<R>> {
    await this.#throttle(tab.url);
    const started = Date.now();
    let page: browser.BrowserPage | undefined;
    try {
      page = await this.#context.newPage();
      await page.goto(tab.url);
      const value = await tab.task(page, this.#state);
      const durationMs = Date.now() - started;
      return {
        id: tab.id,
        ...(tab.group ? { group: tab.group } : {}),
        ok: true,
        value,
        durationMs,
      };
    } catch (err) {
      const durationMs = Date.now() - started;
      return {
        id: tab.id,
        ...(tab.group ? { group: tab.group } : {}),
        ok: false,
        error: (err as Error).message,
        durationMs,
      };
    } finally {
      try {
        await page?.close();
      } catch {
        /* ignore */
      }
    }
  }

  async #throttle(url: string): Promise<void> {
    if (this.#perHostDelay <= 0) return;
    let host: string;
    try {
      host = new URL(url).host;
    } catch {
      return;
    }
    const last = this.#hostLastStart.get(host) ?? 0;
    const now = Date.now();
    const gap = now - last;
    if (gap < this.#perHostDelay) {
      await new Promise((r) => setTimeout(r, this.#perHostDelay - gap));
    }
    this.#hostLastStart.set(host, Date.now());
  }
}
