/**
 * Deterministic rubric — fast, zero-LLM checks over a draft reply. Lets us
 * short-circuit: only hit the LLM critic when the rubric flags an issue.
 *
 * Rubric rules are deliberately conservative — false negatives (a bad reply
 * slips through) are fine here because the LLM critic is the backup. False
 * positives (flagging good replies) would burn budget.
 */

import type { ContentBlock, Message } from '../llm/types.js';
import type { RubricIssue, RubricReport } from './types.js';

const PLACEHOLDER_PATTERNS = [
  /\bTODO\b/,
  /\[\s*(fill|add|replace)\b[^\]]*\]/i,
  /\blorem ipsum\b/i,
  /\bplaceholder\b/i,
  /\blet me get back to you\b/i,
];

const TRIVIAL_LENGTH_CHARS = 6;

export interface RubricContext {
  readonly draft: string;
  readonly messages: readonly Message[];
  readonly hadToolCalls: boolean;
  readonly lastToolResultsHadError: boolean;
}

export function runRubric(ctx: RubricContext): RubricReport {
  const issues: RubricIssue[] = [];
  const text = ctx.draft.trim();

  // 1. Empty / effectively empty.
  if (text.length === 0) {
    issues.push({ code: 'empty-reply', detail: 'Draft was empty or whitespace.' });
    return { pass: false, issues };
  }
  if (text.length < TRIVIAL_LENGTH_CHARS) {
    issues.push({
      code: 'trivial-reply',
      detail: `Draft length ${text.length} is below the trivial threshold (${TRIVIAL_LENGTH_CHARS}).`,
    });
  }

  // 2. Placeholder tokens.
  for (const re of PLACEHOLDER_PATTERNS) {
    if (re.test(text)) {
      issues.push({ code: 'contains-placeholder', detail: `Matched ${re}` });
      break;
    }
  }

  // 3. Last turn had tool errors — reply must acknowledge or address them.
  if (ctx.lastToolResultsHadError) {
    const acknowledges =
      /\b(fail(ed|ure)?|error|couldn'?t|unable|didn'?t work|did not work|issue|problem)\b/i.test(
        text,
      );
    if (!acknowledges) {
      issues.push({
        code: 'tool-error-unacknowledged',
        detail: 'Last tool invocation errored but the reply does not mention it.',
      });
    }
  }

  // 4. Cites a tool that isn't in the conversation trajectory.
  const toolNames = collectToolNames(ctx.messages);
  const citations = extractCitations(text);
  for (const cite of citations) {
    if (!toolNames.has(cite)) {
      issues.push({
        code: 'cited-missing-tool',
        detail: `Reply claims to have used "${cite}" but no matching tool_use exists.`,
      });
      break;
    }
  }

  // 5. Long reply with no sentence punctuation — suggests a dump / truncation.
  if (text.length > 400 && !/[.!?]/.test(text)) {
    issues.push({
      code: 'over-long-without-punctuation',
      detail: 'Long reply lacks sentence terminators; likely truncated or malformed.',
    });
  }

  return { pass: issues.length === 0, issues };
}

function collectToolNames(messages: readonly Message[]): Set<string> {
  const names = new Set<string>();
  for (const m of messages) {
    if (typeof m.content === 'string') continue;
    for (const b of m.content as ContentBlock[]) {
      if (b.type === 'tool_use') names.add(b.name);
    }
  }
  return names;
}

/** Pull potential tool citations — patterns like `I ran xxx` / `called xxx()` / backtick refs. */
function extractCitations(text: string): Set<string> {
  const out = new Set<string>();
  const patterns: RegExp[] = [
    /\b(?:ran|called|invoked|used)\s+[`']?([A-Za-z_][A-Za-z0-9_-]*)[`']?/g,
    /\b([A-Za-z_][A-Za-z0-9_-]*)\(\)/g,
    /`([A-Za-z_][A-Za-z0-9_-]+)`/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const name = m[1];
      if (name && /^[A-Za-z_][A-Za-z0-9_-]{1,63}$/.test(name)) out.add(name);
    }
  }
  return out;
}
