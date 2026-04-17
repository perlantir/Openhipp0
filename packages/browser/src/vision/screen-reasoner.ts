/**
 * Screen reasoner — free-form visual analysis, used for canvas-rendered
 * apps (Figma, Google Sheets, Notion) and PDF-in-browser interactions
 * where the DOM doesn't describe what the user sees.
 *
 * The caller wraps this for HTML5 captions extraction too:
 *   const text = await reasoner.reason({ prompt: 'Extract captions from the
 *     video overlay', screenshotPng });
 */

import type { browser } from '@openhipp0/core';

import type { VisionClient } from './types.js';

export class ScreenReasoner {
  readonly #client: VisionClient;

  constructor(client: VisionClient) {
    this.#client = client;
  }

  async reason(page: browser.BrowserPage, prompt: string): Promise<string> {
    const screenshotPng = await page.screenshot({ fullPage: false });
    return this.#client.reason({ prompt, screenshotPng });
  }
}
