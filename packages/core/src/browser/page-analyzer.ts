/**
 * pageAnalyzer — build a compact PageState from a live BrowserPage.
 *
 * Strategy: pull the accessibility tree via `page.accessibility.snapshot()`
 * (cheap, LLM-friendly), assign stable `@eN` refs, and thin the visible text
 * to a cap so prompts stay small.
 */

import type { AxNode, BrowserPage, FormDefinition, InteractiveElement, PageState } from './types.js';

export interface AnalyzeOptions {
  /** Max characters of visible text to retain. Default 4000. */
  maxTextChars?: number;
  /** Max interactive elements to list. Default 64. */
  maxElements?: number;
}

export async function analyzePage(
  page: BrowserPage,
  opts: AnalyzeOptions = {},
): Promise<PageState> {
  const maxTextChars = opts.maxTextChars ?? 4000;
  const maxElements = opts.maxElements ?? 64;

  const [title, root] = await Promise.all([
    page.title().catch(() => ''),
    page.accessibility.snapshot({ interestingOnly: true }).catch(() => null),
  ]);

  let text = '';
  try {
    text = (await page.innerText('body')).slice(0, maxTextChars);
  } catch {
    // Some pages expose no text (canvas-only) — fall back to empty.
  }

  const elements: InteractiveElement[] = [];
  if (root) walk(root, elements, maxElements);

  const forms = extractForms(elements);

  return {
    url: page.url(),
    title,
    elements,
    text,
    forms,
    navigation: {},
  };
}

function walk(node: AxNode, out: InteractiveElement[], limit: number): void {
  if (out.length >= limit) return;
  const role = (node.role ?? '').toLowerCase();
  const type = axRoleToType(role);
  if (type) {
    out.push({
      ref: `@e${out.length + 1}`,
      type,
      label: (node.name ?? '').slice(0, 200),
      ...(node.value !== undefined && { value: String(node.value) }),
      enabled: node.disabled !== true,
      visible: true,
      attributes: {},
    });
  }
  if (node.children) {
    for (const child of node.children) walk(child, out, limit);
  }
}

function axRoleToType(role: string): InteractiveElement['type'] | null {
  switch (role) {
    case 'button':
      return 'button';
    case 'link':
      return 'link';
    case 'textbox':
    case 'searchbox':
    case 'combobox':
      return 'input';
    case 'textarea':
      return 'textarea';
    case 'combobox-listbox':
    case 'listbox':
    case 'menu':
      return 'select';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    default:
      return null;
  }
}

/**
 * Shallow form detection: elements are grouped into forms based purely on
 * adjacency + the heuristic "a textbox/textarea cluster followed by a button
 * is likely a form". Good enough for most standard HTML forms; site-specific
 * overrides come in the vision mode (Phase 10+).
 */
function extractForms(elements: InteractiveElement[]): FormDefinition[] {
  const forms: FormDefinition[] = [];
  let current: InteractiveElement[] = [];
  for (const el of elements) {
    if (el.type === 'input' || el.type === 'textarea' || el.type === 'select') {
      current.push(el);
    } else if (el.type === 'button' && current.length > 0) {
      forms.push({
        ref: `@f${forms.length + 1}`,
        fields: current,
        submitRef: el.ref,
      });
      current = [];
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      current.push(el);
    }
  }
  if (current.length >= 2) {
    forms.push({ ref: `@f${forms.length + 1}`, fields: current });
  }
  return forms;
}

/** Resolve a ref ("@e3") to its live CSS selector hint. Stub: accessibility-
 *  role selectors aren't stable enough across runs, so callers use the label. */
export function resolveRefToSelector(state: PageState, ref: string): string | undefined {
  const el = state.elements.find((e) => e.ref === ref);
  if (!el) return undefined;
  // `role=button[name="Submit"]` is Playwright's structured locator syntax;
  // the real ActionExecutor uses `page.getByRole(...)` rather than a CSS
  // selector. We return a hint here for logging / fallback.
  return `role=${el.type}[name="${el.label.replace(/"/g, '\\"')}"]`;
}
