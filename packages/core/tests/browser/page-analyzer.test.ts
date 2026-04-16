import { describe, it, expect } from 'vitest';
import { analyzePage, resolveRefToSelector } from '../../src/browser/page-analyzer.js';
import { makeFakePage } from './fake-driver.js';

describe('analyzePage', () => {
  it('assigns compact refs to interactive elements', async () => {
    const page = makeFakePage({ initialTitle: 'Demo', innerText: 'hello world' });
    const state = await analyzePage(page);
    expect(state.title).toBe('Demo');
    expect(state.text).toContain('hello world');
    const refs = state.elements.map((e) => e.ref);
    expect(refs).toEqual(['@e1', '@e2']);
    expect(state.elements[0]?.type).toBe('button');
    expect(state.elements[1]?.type).toBe('input');
  });

  it('truncates visible text to the configured cap', async () => {
    const big = 'x'.repeat(10_000);
    const page = makeFakePage({ innerText: big });
    const state = await analyzePage(page, { maxTextChars: 50 });
    expect(state.text.length).toBeLessThanOrEqual(50);
  });

  it('resolves refs back to structured locator hints', async () => {
    const page = makeFakePage({ initialTitle: 'Demo' });
    const state = await analyzePage(page);
    const sel = resolveRefToSelector(state, '@e1');
    expect(sel).toBe('role=button[name="Sign In"]');
    expect(resolveRefToSelector(state, '@nope')).toBeUndefined();
  });
});
