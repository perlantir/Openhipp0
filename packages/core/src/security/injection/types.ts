/**
 * Prompt-injection defense types (Phase 21).
 *
 * Every fragment of text that lands in an LLM prompt is tagged with
 * `ProvenanceTag`. This is the load-bearing defense (spotlighting,
 * Greshake 2023). Tags drive:
 *
 *   - spotlighting: untrusted fragments are wrapped with clear delimiters
 *     the model is instructed to treat as data, not instructions.
 *   - quarantine: low/untrusted-origin recall results are filtered out of
 *     decision-promoting paths.
 *   - auditing: every emitted prompt can be walked to confirm no
 *     untrusted content slipped into a "system" section.
 *
 * `TrustLevel` / origin strings mirror @openhipp0/memory's connector
 * types structurally — kept local so core doesn't depend on memory.
 * Both sides carry the same literal strings so a memory hook returning
 * { trust: 'low' } slots directly into a core ProvenanceTag.
 */

export type TrustLevel = 'high' | 'medium' | 'low' | 'untrusted';

export type Origin =
  | 'system'          // operator-configured system prompt
  | 'user'            // direct user turn in current session
  | 'tool-output'     // output of a trusted tool (fs/shell/http the agent owns)
  | 'connector'       // pulled in via a Phase-16 connector (trust varies)
  | 'memory'          // recalled from the decision graph / session history
  | 'external'        // anything else from outside the agent boundary
  | 'skill';          // content from an installed skill manifest

export interface ProvenanceTag {
  origin: Origin;
  trust: TrustLevel;
  /** Human-readable source descriptor for debug + audit. */
  label?: string;
  /** Stable identifier (URL, id) for traceability. */
  ref?: string;
}

export interface TaggedFragment {
  readonly tag: ProvenanceTag;
  readonly text: string;
}

export interface TaggedPrompt {
  readonly sections: readonly TaggedFragment[];
}

/** Treat as *data*, not instructions. */
export function isQuarantinedTrust(trust: TrustLevel): boolean {
  return trust === 'low' || trust === 'untrusted';
}

/** Default trust tag for each origin. Callers may override explicitly. */
export function defaultTrust(origin: Origin): TrustLevel {
  switch (origin) {
    case 'system':
      return 'high';
    case 'tool-output':
    case 'skill':
      return 'medium';
    case 'memory':
      return 'medium';
    case 'user':
      return 'medium';
    case 'connector':
      return 'medium';
    case 'external':
    default:
      return 'untrusted';
  }
}
