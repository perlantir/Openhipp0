import { describe, expect, it, vi } from 'vitest';

import { ElementLocator } from '../../src/vision/element-locator.js';
import { ScreenReasoner } from '../../src/vision/screen-reasoner.js';
import type { VisionClient } from '../../src/vision/types.js';
import type { browser } from '@openhipp0/core';

function makePage(axName = 'Continue'): browser.BrowserPage {
  return {
    url: () => '',
    async title() { return ''; },
    async goto() {},
    async click() {},
    async fill() {},
    async type() {},
    async selectOption() {},
    async content() { return ''; },
    async innerText() { return ''; },
    async screenshot() { return Buffer.from([0x89]); },
    async evaluate() { return undefined as never; },
    mouse: { async wheel() {} },
    async waitForTimeout() {},
    accessibility: {
      async snapshot() {
        return { role: 'button', name: axName };
      },
    },
    async close() {},
  };
}

function makeClient(ref: string | null): VisionClient {
  return {
    locate: vi.fn().mockResolvedValue({ ref, reasoning: 'mock reasoning' }),
    reason: vi.fn().mockResolvedValue('analyzed'),
  };
}

describe('ElementLocator', () => {
  it('short-circuits when preferRef already exists in the a11y tree', async () => {
    const client = makeClient('vision-ref');
    const locator = new ElementLocator(client);
    const page = makePage('Sign in');
    const res = await locator.locate(page, { description: 'sign in button', preferRef: 'name:Sign in' });
    expect(res.ref).toBe('name:Sign in');
    expect(res.usedPath).toBe('prefer');
    expect(client.locate).not.toHaveBeenCalled();
  });

  it('falls back to vision when preferRef is absent', async () => {
    const client = makeClient('vision-found');
    const locator = new ElementLocator(client);
    const page = makePage('Something else');
    const res = await locator.locate(page, { description: 'shopping cart', preferRef: 'name:nope' });
    expect(res.usedPath).toBe('vision');
    expect(res.ref).toBe('vision-found');
    expect(res.reasoning).toBe('mock reasoning');
  });

  it('returns null-ref + usedPath=none when vision finds nothing', async () => {
    const client = makeClient(null);
    const locator = new ElementLocator(client);
    const page = makePage();
    const res = await locator.locate(page, { description: 'nothing' });
    expect(res.ref).toBeNull();
    expect(res.usedPath).toBe('none');
  });
});

describe('ScreenReasoner', () => {
  it('delegates to the client with the page screenshot', async () => {
    const client = makeClient('x');
    const reasoner = new ScreenReasoner(client);
    const page = makePage();
    const out = await reasoner.reason(page, 'describe');
    expect(out).toBe('analyzed');
    expect(client.reason).toHaveBeenCalledOnce();
  });
});
