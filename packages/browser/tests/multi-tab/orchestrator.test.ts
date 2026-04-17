import { describe, expect, it } from 'vitest';

import { MultiTabOrchestrator, type TabSpec } from '../../src/multi-tab/orchestrator.js';
import type { browser } from '@openhipp0/core';

function makeContext(): { context: browser.BrowserContext; closedPages: number } {
  let closedPages = 0;
  const context: browser.BrowserContext = {
    async newPage() {
      const page: browser.BrowserPage = {
        url: () => '',
        async title() { return ''; },
        async goto() {},
        async click() {},
        async fill() {},
        async type() {},
        async selectOption() {},
        async content() { return ''; },
        async innerText() { return ''; },
        async screenshot() { return Buffer.alloc(0); },
        async evaluate() { return undefined as never; },
        mouse: { async wheel() {} },
        async waitForTimeout() {},
        accessibility: { async snapshot() { return null; } },
        async close() { closedPages += 1; },
      };
      return page;
    },
    async close() {},
    async cookies() { return []; },
    async addCookies() {},
  };
  return {
    context,
    get closedPages() { return closedPages; },
  } as unknown as { context: browser.BrowserContext; closedPages: number };
}

describe('MultiTabOrchestrator', () => {
  it('runs N tabs in parallel + aggregates results by group', async () => {
    const { context } = makeContext();
    const orch = new MultiTabOrchestrator({ context, maxConcurrency: 2, perHostDelayMs: 0 });
    const tabs: TabSpec<string>[] = [
      { id: 't1', url: 'https://a/', group: 'search', task: async () => 'ra' },
      { id: 't2', url: 'https://b/', group: 'search', task: async () => 'rb' },
      { id: 't3', url: 'https://c/', task: async () => 'rc' },
    ];
    const result = await orch.runAll(tabs);
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r) => r.ok)).toBe(true);
    expect(result.perGroup['search']).toHaveLength(2);
  });

  it('records errors without stopping sibling tabs', async () => {
    const { context } = makeContext();
    const orch = new MultiTabOrchestrator({ context, perHostDelayMs: 0 });
    const result = await orch.runAll<string>([
      { id: 'ok', url: 'https://ok/', task: async () => 'great' },
      { id: 'bad', url: 'https://bad/', task: async () => { throw new Error('oops'); } },
    ]);
    const ok = result.results.find((r) => r.id === 'ok');
    const bad = result.results.find((r) => r.id === 'bad');
    expect(ok?.ok).toBe(true);
    expect(bad?.ok).toBe(false);
    expect(bad?.error).toContain('oops');
  });

  it('shares CrossTabState across tabs', async () => {
    const { context } = makeContext();
    const orch = new MultiTabOrchestrator({ context, perHostDelayMs: 0 });
    const result = await orch.runAll<number>([
      { id: 'a', url: 'https://a/', task: async (_p, s) => { s.set('counter', 1); return 1; } },
      { id: 'b', url: 'https://b/', task: async (_p, s) => { const v = (s.get('counter') as number | undefined) ?? 0; s.set('counter', v + 10); return v + 10; } },
    ]);
    // Execution order not guaranteed, but final state must have 1+10 if b saw a, or just 10/1 if interleaved.
    const counter = result.state['counter'];
    expect([1, 10, 11]).toContain(counter);
    expect(result.results).toHaveLength(2);
  });
});
