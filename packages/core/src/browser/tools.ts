/**
 * Browser tools — Hipp0 Tool wrappers around BrowserEngine + ActionExecutor.
 *
 * Every tool takes a shared BrowserEngine via closure; callers build the
 * tool set via `createBrowserTools(engine)` and register the returned
 * array on a ToolRegistry.
 *
 * Permissions: browser_* tools require `browser.use` + `net.fetch` since
 * every action hits the network. File downloads additionally need
 * `fs.write` (not covered by these six tools; downloads come in a later
 * sub-phase).
 */

import { z } from 'zod';
import type { Tool } from '../tools/types.js';
import { ActionExecutor } from './action-executor.js';
import { analyzePage } from './page-analyzer.js';
import type { BrowserEngine } from './engine.js';
import {
  createSystemResolver,
  resolveAndGuard,
  ssrfErrorCode,
  type DnsResolver,
} from './ssrf.js';
import type { BrowserPage } from './types.js';

export interface BrowserToolsOptions {
  /** Optional DNS resolver — defaults to node:dns/promises. Inject for tests. */
  readonly resolver?: DnsResolver;
  /**
   * Optional callback the tools use to ask "is this URL allowed?" before
   * navigation. When absent, all URLs pass this gate (the SSRF guard still
   * runs). Production callers should wire this to a policy engine.
   */
  readonly isUrlAllowed?: (url: string) => boolean;
}

/** Shared page — created lazily + reused across tool calls for the same engine. */
interface PageHolder {
  page: BrowserPage | undefined;
}

async function ensurePage(engine: BrowserEngine, holder: PageHolder): Promise<BrowserPage> {
  if (!holder.page) {
    holder.page = await engine.newPage();
  }
  return holder.page;
}

export function createBrowserTools(
  engine: BrowserEngine,
  opts: BrowserToolsOptions = {},
): Tool<object>[] {
  const holder: PageHolder = { page: undefined };
  const resolver = opts.resolver ?? createSystemResolver();
  const isUrlAllowed = opts.isUrlAllowed ?? (() => true);

  const navigate: Tool<{ url: string }> = {
    name: 'browser_navigate',
    description:
      'Navigate the browser to a URL. Guarded by an SSRF + DNS-rebind check: private/loopback/link-local addresses are blocked, and each call resolves DNS before connecting.',
    permissions: ['browser.use', 'net.fetch'],
    inputSchema: {
      type: 'object',
      required: ['url'],
      properties: { url: { type: 'string' } },
    },
    validator: z.object({ url: z.string().url() }),
    async execute(params) {
      if (!isUrlAllowed(params.url)) {
        return {
          ok: false,
          output: 'URL blocked by policy',
          errorCode: 'HIPP0_BROWSER_URL_BLOCKED_BY_POLICY',
        };
      }
      const guard = await resolveAndGuard(params.url, resolver);
      if (!guard.ok) {
        return {
          ok: false,
          output: `${guard.error.kind}: ${guard.error.detail}`,
          errorCode: ssrfErrorCode(guard.error.kind),
        };
      }
      const page = await ensurePage(engine, holder);
      const exec = new ActionExecutor(page);
      const r = await exec.execute({ kind: 'navigate', url: guard.resolution.url });
      return r.ok
        ? {
            ok: true,
            output: `navigated to ${params.url} (pinned=${guard.resolution.ip})`,
          }
        : { ok: false, output: r.error ?? 'navigation failed', errorCode: 'HIPP0_BROWSER_NAV' };
    },
  };

  const click: Tool<{ ref: string }> = {
    name: 'browser_click',
    description: 'Click an element on the current page by its @ref handle.',
    permissions: ['browser.use'],
    inputSchema: {
      type: 'object',
      required: ['ref'],
      properties: { ref: { type: 'string' } },
    },
    validator: z.object({ ref: z.string().min(1) }),
    async execute(params) {
      const page = await ensurePage(engine, holder);
      const exec = new ActionExecutor(page);
      const r = await exec.execute({ kind: 'click', ref: params.ref });
      return r.ok
        ? { ok: true, output: `clicked ${params.ref}` }
        : { ok: false, output: r.error ?? 'click failed', errorCode: 'HIPP0_BROWSER_CLICK' };
    },
  };

  const type_: Tool<{ ref: string; text: string; clear?: boolean }> = {
    name: 'browser_type',
    description: 'Type text into an input identified by its @ref handle.',
    permissions: ['browser.use'],
    inputSchema: {
      type: 'object',
      required: ['ref', 'text'],
      properties: {
        ref: { type: 'string' },
        text: { type: 'string' },
        clear: { type: 'boolean', default: false },
      },
    },
    validator: z.object({ ref: z.string().min(1), text: z.string(), clear: z.boolean().optional() }),
    async execute(params) {
      const page = await ensurePage(engine, holder);
      const exec = new ActionExecutor(page);
      const r = await exec.execute({
        kind: 'type',
        ref: params.ref,
        text: params.text,
        clear: params.clear ?? false,
      });
      return r.ok
        ? { ok: true, output: `typed ${params.text.length} chars into ${params.ref}` }
        : { ok: false, output: r.error ?? 'type failed', errorCode: 'HIPP0_BROWSER_TYPE' };
    },
  };

  const screenshot: Tool<object> = {
    name: 'browser_screenshot',
    description: 'Take a full-page screenshot. Returns base64-encoded PNG.',
    permissions: ['browser.use'],
    inputSchema: { type: 'object' },
    validator: z.object({}),
    async execute() {
      const page = await ensurePage(engine, holder);
      const exec = new ActionExecutor(page);
      const r = await exec.execute({ kind: 'screenshot' });
      if (!r.ok || !r.screenshot) {
        return { ok: false, output: r.error ?? 'screenshot failed', errorCode: 'HIPP0_BROWSER_SCREENSHOT' };
      }
      return { ok: true, output: r.screenshot, metadata: { encoding: 'base64-png' } };
    },
  };

  const extract: Tool<{ what?: 'state' | 'text' | 'html' }> = {
    name: 'browser_extract',
    description: 'Extract the current page state, visible text, or raw HTML.',
    permissions: ['browser.use'],
    inputSchema: {
      type: 'object',
      properties: { what: { type: 'string', enum: ['state', 'text', 'html'], default: 'state' } },
    },
    validator: z.object({ what: z.enum(['state', 'text', 'html']).optional() }),
    async execute(params) {
      const page = await ensurePage(engine, holder);
      const exec = new ActionExecutor(page);
      const r = await exec.execute({ kind: 'extract', what: params.what ?? 'state' });
      return r.ok
        ? {
            ok: true,
            output:
              typeof r.extracted === 'string' ? r.extracted : JSON.stringify(r.extracted ?? {}),
          }
        : { ok: false, output: r.error ?? 'extract failed', errorCode: 'HIPP0_BROWSER_EXTRACT' };
    },
  };

  const analyze: Tool<object> = {
    name: 'browser_state',
    description: 'Return a compact PageState: URL, title, interactive elements, visible text.',
    permissions: ['browser.use'],
    inputSchema: { type: 'object' },
    validator: z.object({}),
    async execute() {
      const page = await ensurePage(engine, holder);
      const state = await analyzePage(page);
      return { ok: true, output: JSON.stringify(state) };
    },
  };

  return [navigate as Tool<object>, click as Tool<object>, type_ as Tool<object>, screenshot, extract as Tool<object>, analyze];
}
