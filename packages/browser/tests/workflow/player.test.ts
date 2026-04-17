import { describe, expect, it, vi } from 'vitest';

import { playWorkflow } from '../../src/workflow/player.js';
import { Recorder } from '../../src/workflow/recorder.js';
import type { browser } from '@openhipp0/core';

function makePage(failingSelector: string | null = null): {
  page: browser.BrowserPage;
  calls: string[];
} {
  const calls: string[] = [];
  const page: browser.BrowserPage = {
    url: () => '',
    async title() { return ''; },
    async goto(url: string) { calls.push(`goto:${url}`); },
    async click(sel: string) {
      if (sel === failingSelector) throw new Error(`not found: ${sel}`);
      calls.push(`click:${sel}`);
    },
    async fill(sel: string, v: string) { calls.push(`fill:${sel}=${v}`); },
    async type() {},
    async selectOption(sel: string, v: string) { calls.push(`sel:${sel}=${v}`); },
    async content() { return ''; },
    async innerText() { return ''; },
    async screenshot() { return Buffer.alloc(0); },
    async evaluate() { return undefined as never; },
    mouse: { async wheel(_x: number, y: number) { calls.push(`scroll:${y}`); } },
    async waitForTimeout(ms: number) { calls.push(`wait:${ms}`); },
    accessibility: { async snapshot() { return null; } },
    async close() {},
  };
  return { page, calls };
}

describe('playWorkflow', () => {
  it('runs a happy-path workflow with parameter substitution', async () => {
    const rec = new Recorder({ name: 'w' });
    rec.parameter({ name: 'email' });
    rec.navigate('https://x/login');
    rec.type('#email', '${email}');
    rec.click('#submit', 'Submit');
    rec.scroll(200);
    rec.wait(50);
    const wf = rec.build();

    const { page, calls } = makePage();
    const result = await playWorkflow(wf, page, { parameters: { email: 'a@b.com' } });
    expect(result.ok).toBe(true);
    expect(result.completed).toBe(5);
    expect(calls).toEqual([
      'goto:https://x/login',
      'fill:#email=a@b.com',
      'click:#submit',
      'scroll:200',
      'wait:50',
    ]);
  });

  it('uses the healer when a selector fails and completes successfully', async () => {
    const rec = new Recorder({ name: 'w' });
    rec.click('#old', 'Old button', 'button');
    const wf = rec.build();

    const { page, calls } = makePage('#old');
    const healer = vi.fn().mockResolvedValue('#new');
    const result = await playWorkflow(wf, page, { healer });
    expect(result.ok).toBe(true);
    expect(result.healedSteps).toEqual([{ index: 0, original: '#old', healed: '#new' }]);
    expect(calls).toEqual(['click:#new']);
    expect(healer).toHaveBeenCalledOnce();
  });

  it('fails cleanly at the first unrecoverable step', async () => {
    const rec = new Recorder({ name: 'w' });
    rec.click('#broken');
    const wf = rec.build();

    const { page } = makePage('#broken');
    const result = await playWorkflow(wf, page);
    expect(result.ok).toBe(false);
    expect(result.failedAt).toBe(0);
    expect(result.error).toContain('not found');
  });
});
