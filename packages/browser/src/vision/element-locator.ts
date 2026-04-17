/**
 * Natural-language element locator.
 *
 * Flow:
 *   1. If `preferRef` is set and the a11y tree still has it, short-circuit.
 *   2. Screenshot + a11y snapshot + `VisionClient.locate(...)`.
 *   3. Return the ref + reasoning trace + timing.
 */

import type { browser } from '@openhipp0/core';

import type { LocateOptions, LocateResult, VisionClient } from './types.js';

function axContainsRef(root: browser.AxNode | null, ref: string): boolean {
  if (!root) return false;
  const name = `name:${root.name ?? ''}`;
  const role = `role:${root.role ?? ''}`;
  if (ref === name || ref === role) return true;
  for (const c of root.children ?? []) if (axContainsRef(c, ref)) return true;
  return false;
}

export class ElementLocator {
  readonly #client: VisionClient;

  constructor(client: VisionClient) {
    this.#client = client;
  }

  async locate(page: browser.BrowserPage, opts: LocateOptions): Promise<LocateResult> {
    const started = Date.now();
    const ax = await page.accessibility.snapshot({ interestingOnly: true });
    if (opts.preferRef && axContainsRef(ax, opts.preferRef)) {
      return {
        ref: opts.preferRef,
        usedPath: 'prefer',
        durationMs: Date.now() - started,
      };
    }
    const screenshotPng = await page.screenshot({ fullPage: false });
    const res = await this.#client.locate({
      description: opts.description,
      screenshotPng,
      ax,
    });
    return {
      ref: res.ref,
      ...(res.reasoning ? { reasoning: res.reasoning } : {}),
      usedPath: res.ref ? 'vision' : 'none',
      durationMs: Date.now() - started,
    };
  }
}
