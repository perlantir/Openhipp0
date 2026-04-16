/**
 * planner — naive natural-language → BrowserAction[] decomposition.
 *
 * This is a stub, intentionally. The full "god mode" planner (loops over
 * PageState after each step, retries on failure, escalates to vision on
 * visual complexity) is a Phase 10+ item requiring an LLM client plumbed
 * in. For Phase 9 we ship:
 *
 *   - A structural interface (`Planner`) that real implementations meet
 *   - A `ScriptedPlanner` that returns a caller-supplied action list
 *   - A `heuristicPlan()` helper that parses very simple English
 *     ("go to <url>", "click the <noun> button") for smoke tests
 */

import type { BrowserAction } from './types.js';

export interface Planner {
  plan(task: string, context?: unknown): Promise<BrowserAction[]>;
}

export class ScriptedPlanner implements Planner {
  constructor(private readonly actions: readonly BrowserAction[]) {}

  async plan(_task: string): Promise<BrowserAction[]> {
    return [...this.actions];
  }
}

/**
 * Parse very simple task descriptions into a short action list. Supports:
 *   "go to https://example.com"
 *   "click the Sign In button"
 *   "type "hello world" into Search"
 *   "screenshot"
 * Anything else produces an empty plan — callers should fall back to an LLM.
 */
export function heuristicPlan(task: string): BrowserAction[] {
  const actions: BrowserAction[] = [];
  // Split on sentence boundaries (". " / "! " / "? " / newline) or the word
  // "then" — NOT on bare dots, or we'd chop URLs in half.
  const lines = task
    .split(/(?<=[.!?])\s+|\n+|\bthen\b/gi)
    .map((s) => s.trim().replace(/[.!?]+$/, ''))
    .filter(Boolean);

  for (const line of lines) {
    const gotoMatch = line.match(/^\s*(?:go to|navigate to|open)\s+(\S+)/i);
    if (gotoMatch && gotoMatch[1]) {
      actions.push({ kind: 'navigate', url: gotoMatch[1] });
      continue;
    }
    const clickMatch = line.match(/^\s*click\s+(?:the\s+)?([^,]+?)\s+(?:button|link)?\s*$/i);
    if (clickMatch && clickMatch[1]) {
      // The caller is expected to resolve `@<label>` refs via page-analyzer.
      actions.push({ kind: 'click', ref: `@${clickMatch[1].trim()}` });
      continue;
    }
    const typeMatch = line.match(/^\s*type\s+"([^"]+)"\s+(?:into|in)\s+(.+)$/i);
    if (typeMatch && typeMatch[1] && typeMatch[2]) {
      actions.push({ kind: 'type', ref: `@${typeMatch[2].trim()}`, text: typeMatch[1] });
      continue;
    }
    if (/^\s*screenshot/i.test(line)) {
      actions.push({ kind: 'screenshot' });
      continue;
    }
  }

  return actions;
}
