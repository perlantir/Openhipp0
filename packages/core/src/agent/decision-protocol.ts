/**
 * Decision protocol — structured directives the agent can emit in its text
 * output. Governance-aware callers (dashboard, CLI, orchestrator) parse
 * these and can pause / re-route before the next iteration.
 *
 * Phase 1g treats all directives as advisory — the runtime does not
 * short-circuit on AWAIT_APPROVAL or ASK_FOR_CLARIFICATION. Phase 5's
 * policy engine makes these load-bearing.
 */

export type DecisionCode =
  | 'PROCEED'
  | 'SKIP'
  | 'OVERRIDE_TO'
  | 'ASK_FOR_CLARIFICATION'
  | 'AWAIT_APPROVAL';

export const DECISION_CODES: readonly DecisionCode[] = [
  'PROCEED',
  'SKIP',
  'OVERRIDE_TO',
  'ASK_FOR_CLARIFICATION',
  'AWAIT_APPROVAL',
] as const;

export interface DecisionDirective {
  code: DecisionCode;
  argument?: string;
}

const DIRECTIVE_RE =
  /^HIPP0_DECISION:\s*(PROCEED|SKIP|OVERRIDE_TO|ASK_FOR_CLARIFICATION|AWAIT_APPROVAL)(?:\s+(.+?))?\s*$/gm;

/**
 * Extract all HIPP0_DECISION directives from the assistant's text output.
 * Returns them in order of appearance. Empty array means the agent didn't
 * emit a directive (equivalent to PROCEED).
 */
export function parseDecisionDirectives(text: string): DecisionDirective[] {
  const out: DecisionDirective[] = [];
  let m: RegExpExecArray | null;
  DIRECTIVE_RE.lastIndex = 0;
  while ((m = DIRECTIVE_RE.exec(text)) !== null) {
    const directive: DecisionDirective = { code: m[1] as DecisionCode };
    if (m[2]) directive.argument = m[2].trim();
    out.push(directive);
  }
  return out;
}
