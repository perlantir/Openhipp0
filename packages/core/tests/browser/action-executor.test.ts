import { describe, it, expect } from 'vitest';
import { ActionExecutor } from '../../src/browser/action-executor.js';
import { makeFakePage } from './fake-driver.js';

describe('ActionExecutor', () => {
  it('navigates and reports duration', async () => {
    const page = makeFakePage();
    const exec = new ActionExecutor(page);
    const r = await exec.execute({ kind: 'navigate', url: 'https://example.com' });
    expect(r.ok).toBe(true);
    expect(page.url()).toBe('https://example.com');
    expect(typeof r.durationMs).toBe('number');
  });

  it('returns ok:false on click against an unknown ref', async () => {
    const page = makeFakePage();
    const exec = new ActionExecutor(page);
    const r = await exec.execute({ kind: 'click', ref: '@e999' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown element ref/);
  });

  it('clicks a known element via its ref', async () => {
    const page = makeFakePage();
    const exec = new ActionExecutor(page);
    const r = await exec.execute({ kind: 'click', ref: '@e1' });
    expect(r.ok).toBe(true);
    const clicks = (page as typeof page & { _clicks: string[] })._clicks;
    expect(clicks[0]).toContain('button');
  });

  it('returns a base64 PNG on screenshot', async () => {
    const page = makeFakePage();
    const exec = new ActionExecutor(page);
    const r = await exec.execute({ kind: 'screenshot' });
    expect(r.ok).toBe(true);
    expect(r.screenshot).toBe(Buffer.from('fake-png').toString('base64'));
  });

  it('extracts the page state', async () => {
    const page = makeFakePage({ initialTitle: 'T' });
    const exec = new ActionExecutor(page);
    const r = await exec.execute({ kind: 'extract', what: 'state' });
    expect(r.ok).toBe(true);
    expect(typeof r.extracted === 'object' && r.extracted && 'title' in r.extracted).toBe(true);
  });
});
