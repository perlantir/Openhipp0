/**
 * Complexity heuristic — cheap, deterministic, no LLM. Returns a verdict
 * the runtime uses to decide whether to even invoke the planner.
 *
 * Tuned to be conservative on the "should plan" side: we'd rather miss a
 * planning opportunity than burn budget planning a trivial ask.
 */

import type { ComplexityVerdict } from './types.js';

const IMPERATIVE_STARTERS = [
  'build',
  'create',
  'implement',
  'deploy',
  'set up',
  'setup',
  'refactor',
  'migrate',
  'debug',
  'fix',
  'write',
  'design',
  'audit',
  'test',
  'review',
  'analyze',
  'investigate',
  'wire',
  'configure',
  'install',
];

/** Word-shaped ordinal cues. Each distinct pattern counts once. */
const ORDINAL_WORD_MARKERS = [
  /\bfirst\b/i,
  /\bthen\b/i,
  /\bnext\b/i,
  /\bafter that\b/i,
  /\bafterwards\b/i,
  /\bfinally\b/i,
  /\blastly\b/i,
  /\bfollowed by\b/i,
  /\bstep\s+\d+/i,
];
/** List-item cues. We count ALL matches (each item is a subtask). */
const NUMBERED_LIST = /^\s*\d+[.)]/gm;
const BULLET_LIST = /^\s*[-*]\s+/gm;

const EXPLICIT_PLAN_PHRASES = [
  /plan (this|it) (out|step.by.step)/i,
  /make (me )?a plan/i,
  /break (this|it) (down|into steps)/i,
  /decompose (the )?task/i,
  /show me the steps/i,
  /step.by.step/i,
];

export function estimateComplexity(userMessage: string): ComplexityVerdict {
  const text = userMessage.trim();
  const signals: string[] = [];

  // 1. Explicit user ask always wins.
  for (const re of EXPLICIT_PLAN_PHRASES) {
    if (re.test(text)) {
      signals.push('explicit-request');
      return { shouldPlan: true, estimatedSubtasks: 3, signals };
    }
  }

  // 2. Imperative verb count. Check the first non-ordinal token of each
  // sentence, so "First, configure the database" still counts "configure".
  const sentences = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  let imperativeCount = 0;
  for (const s of sentences) {
    const leading = stripOrdinalPrefix(s);
    const firstWord = leading.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
    const firstTwo = leading.toLowerCase().split(/\s+/, 2).join(' ');
    if (IMPERATIVE_STARTERS.includes(firstWord) || firstTwo === 'set up') {
      imperativeCount++;
    }
  }
  if (imperativeCount >= 2) signals.push(`imperatives:${imperativeCount}`);

  // 3a. Word-shaped ordinals — each distinct pattern counts once.
  let ordinalWordHits = 0;
  for (const re of ORDINAL_WORD_MARKERS) if (re.test(text)) ordinalWordHits++;

  // 3b. List-item count — numbered + bullet, ALL matches (each item = subtask).
  const listItemCount =
    (text.match(NUMBERED_LIST)?.length ?? 0) + (text.match(BULLET_LIST)?.length ?? 0);
  const ordinalHits = Math.max(ordinalWordHits, listItemCount);
  if (ordinalHits >= 2) signals.push(`ordinal:${ordinalHits}`);

  // 4. Long task descriptions (> 80 words) usually have sub-structure.
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount > 80) signals.push(`long:${wordCount}`);

  // Threshold: shouldPlan iff estimated subtasks ≥ 3.
  const estimatedSubtasks = Math.max(imperativeCount, ordinalHits, wordCount > 120 ? 3 : 0);
  const shouldPlan = estimatedSubtasks >= 3;
  return { shouldPlan, estimatedSubtasks, signals };
}

/** Strip leading ordinal token ("First,", "1.", "- ") so we can see the verb. */
function stripOrdinalPrefix(s: string): string {
  return s
    .replace(/^\s*(first|then|next|finally|lastly|afterwards)\s*,?\s+/i, '')
    .replace(/^\s*(after that)\s*,?\s+/i, '')
    .replace(/^\s*\d+[.)]\s*/, '')
    .replace(/^\s*[-*]\s+/, '')
    .trim();
}
