import { describe, expect, it } from 'vitest';

import { capturePageSnapshot } from '../../src/snapshot/capture.js';
import type { SessionId } from '../../src/snapshot/types.js';
import { createFakeContext, createFakePage } from './fake-page.js';

const SESSION = 'sess-a' as SessionId;
const PNG1 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01]);
const PNG2 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02]);

describe('capturePageSnapshot', () => {
  it('captures URL, title, DOM, screenshot, cookies, and a11y tree', async () => {
    const { page } = createFakePage({
      url: 'https://example.com',
      title: 'Example',
      html: '<html><body>hi</body></html>',
      png: PNG1,
      ax: { role: 'document', name: 'Example', children: [] },
    });
    const { context } = createFakeContext([
      { name: 'session', value: 'abc', domain: '.example.com', path: '/' },
    ]);
    const snap = await capturePageSnapshot({ page, context, sessionId: SESSION });
    expect(snap.url).toBe('https://example.com');
    expect(snap.title).toBe('Example');
    expect(snap.dom.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(snap.dom.contentGzB64).toBeTruthy();
    expect(snap.screenshot.pngB64).toBeTruthy();
    expect(snap.cookies).toHaveLength(1);
    expect(snap.ax?.role).toBe('document');
  });

  it('dedups DOM + screenshot when identical to the previous snapshot', async () => {
    const { page, mutate } = createFakePage({
      url: 'https://x/',
      title: 't',
      html: '<body>same</body>',
      png: PNG1,
      ax: null,
    });
    const { context } = createFakeContext();
    const first = await capturePageSnapshot({ page, context, sessionId: SESSION });
    mutate({ url: 'https://x/second' });
    const second = await capturePageSnapshot({ page, context, sessionId: SESSION, previous: first });
    expect(second.dom.contentGzB64).toBeUndefined();
    expect(second.dom.refPrevId).toBe(first.id);
    expect(second.screenshot.refPrevId).toBe(first.id);
  });

  it('stores new content when DOM changes', async () => {
    const { page, mutate } = createFakePage({
      url: 'https://x/',
      title: 't',
      html: '<body>v1</body>',
      png: PNG1,
      ax: null,
    });
    const { context } = createFakeContext();
    const first = await capturePageSnapshot({ page, context, sessionId: SESSION });
    mutate({ html: '<body>v2</body>', png: PNG2 });
    const second = await capturePageSnapshot({ page, context, sessionId: SESSION, previous: first });
    expect(second.dom.contentGzB64).toBeTruthy();
    expect(second.dom.refPrevId).toBeUndefined();
    expect(second.screenshot.pngB64).toBeTruthy();
  });

  it('passes through network + console buffers', async () => {
    const { page } = createFakePage({ url: 'u', title: 't', html: '<x/>', png: PNG1, ax: null });
    const { context } = createFakeContext();
    const snap = await capturePageSnapshot({
      page,
      context,
      sessionId: SESSION,
      network: [
        {
          requestId: 'r1',
          method: 'GET',
          url: 'https://api/x',
          status: 200,
          startedAt: new Date().toISOString(),
        },
      ],
      console: [{ level: 'warn', text: 'meh', takenAt: new Date().toISOString() }],
    });
    expect(snap.network).toHaveLength(1);
    expect(snap.console).toHaveLength(1);
  });
});
