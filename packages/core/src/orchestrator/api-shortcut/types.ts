/**
 * API-shortcut planner — detects that a pending UI action corresponds
 * to a simpler API request and substitutes the API call for the UI
 * drive.
 *
 * Scope: structural types + heuristic matcher. Integration with the
 * streaming runtime / agent loop is a thin wrapper around `propose`
 * that callers bolt onto their planner.
 */

export interface ObservedApiCall {
  readonly method: string;
  readonly urlPattern: string; // e.g. "https://api.example.com/users/:id"
  readonly requestBodySample?: string;
  readonly responseSample?: string;
  readonly contentType?: string;
  readonly occurrences: number;
}

export interface UiActionIntent {
  /** Short description of what the agent is about to do. */
  readonly description: string;
  /** Selector or ref the agent is about to click / fill / submit. */
  readonly target?: string;
  /** Free-form hints the agent may supply (e.g. form field name map). */
  readonly fieldHints?: Readonly<Record<string, unknown>>;
  /** Host the action is scoped to. */
  readonly host: string;
}

export interface ApiShortcut {
  readonly method: string;
  readonly urlPattern: string;
  readonly confidence: number; // 0..1
  readonly reason: string;
  /** Suggested request body, if inferable. */
  readonly bodyHint?: string;
}

export interface PlannerInput {
  readonly intent: UiActionIntent;
  readonly observed: readonly ObservedApiCall[];
  /** Minimum occurrence count before a candidate is considered. */
  readonly minOccurrences?: number;
  /** Minimum confidence before returning a shortcut. Default 0.6. */
  readonly minConfidence?: number;
}

export interface PlannerOutput {
  readonly shortcut: ApiShortcut | null;
  /** Evidence trail for debugging. */
  readonly evaluated: readonly {
    readonly candidate: ObservedApiCall;
    readonly score: number;
    readonly reason: string;
  }[];
}
