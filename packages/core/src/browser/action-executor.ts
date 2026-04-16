/**
 * ActionExecutor — translate BrowserAction into concrete BrowserPage calls.
 *
 * Every action is wrapped in a try/catch so downstream planners can react to
 * failures without the loop blowing up.
 */

import type { ActionResult, BrowserAction, BrowserPage, PageState } from './types.js';
import { analyzePage, resolveRefToSelector } from './page-analyzer.js';

export class ActionExecutor {
  constructor(private readonly page: BrowserPage) {}

  async execute(action: BrowserAction): Promise<ActionResult> {
    const startedAt = Date.now();
    try {
      switch (action.kind) {
        case 'navigate':
          await this.page.goto(action.url);
          return { ok: true, durationMs: Date.now() - startedAt };

        case 'click':
          await this.clickByRef(action.ref);
          return { ok: true, durationMs: Date.now() - startedAt };

        case 'type':
          await this.typeByRef(action.ref, action.text, action.clear ?? false);
          return { ok: true, durationMs: Date.now() - startedAt };

        case 'select':
          await this.selectByRef(action.ref, action.value);
          return { ok: true, durationMs: Date.now() - startedAt };

        case 'scroll':
          await this.page.mouse.wheel(0, action.deltaY);
          return { ok: true, durationMs: Date.now() - startedAt };

        case 'wait':
          await this.page.waitForTimeout(action.ms);
          return { ok: true, durationMs: Date.now() - startedAt };

        case 'screenshot': {
          const buf = await this.page.screenshot({ fullPage: true });
          return {
            ok: true,
            screenshot: buf.toString('base64'),
            durationMs: Date.now() - startedAt,
          };
        }

        case 'extract':
          return {
            ok: true,
            extracted: await this.extract(action.what),
            durationMs: Date.now() - startedAt,
          };
      }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  private async clickByRef(ref: string): Promise<void> {
    const selector = await this.resolveRef(ref);
    await this.page.click(selector);
  }

  private async typeByRef(ref: string, text: string, clear: boolean): Promise<void> {
    const selector = await this.resolveRef(ref);
    if (clear) await this.page.fill(selector, '');
    await this.page.type(selector, text);
  }

  private async selectByRef(ref: string, value: string): Promise<void> {
    const selector = await this.resolveRef(ref);
    await this.page.selectOption(selector, value);
  }

  private async extract(what: 'state' | 'text' | 'html'): Promise<string | PageState> {
    if (what === 'state') return analyzePage(this.page);
    if (what === 'html') return this.page.content();
    return this.page.innerText('body');
  }

  private async resolveRef(ref: string): Promise<string> {
    const state = await analyzePage(this.page, { maxTextChars: 0, maxElements: 128 });
    const resolved = resolveRefToSelector(state, ref);
    if (!resolved) throw new Error(`unknown element ref: ${ref}`);
    return resolved;
  }
}
