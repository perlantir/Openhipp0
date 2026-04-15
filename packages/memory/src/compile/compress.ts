/**
 * H0C compression — three rendering formats for compiled decision lists.
 *
 *   markdown  — full title + reasoning for every decision. No compression.
 *                Useful for small contexts (<20 decisions).
 *   h0c       — top 5 full, next 10 as title-only bullets, rest grouped by
 *                their primary tag ("Tag X: N decisions"). Target: ~8–10x
 *                smaller than `markdown` for typical loads.
 *   ultra     — top 3 titles, everything else collapsed to tag-group counts.
 *                Target: ~20–33x smaller than `markdown`. Used when the
 *                token budget is tight.
 *
 * The compressor does not enforce a strict byte budget — the caller's
 * `compileContext` applies the budget check and picks a more aggressive
 * format if the chosen one overflows. Keeps the compressor pure + testable.
 */

import type { Decision } from '../db/schema.js';
import type { ScoredDecision } from './scoring.js';

export type CompressionFormat = 'markdown' | 'h0c' | 'ultra';

export interface CompressedSection {
  title: string;
  body: string;
  /** Number of decisions represented (counts grouped decisions collectively). */
  decisionCount: number;
  /** Approx token count (chars / 4) for budgeting. */
  estTokens: number;
}

/** Entry point. Compresses a scored decision list into a single prompt section. */
export function compressDecisions(
  scored: readonly ScoredDecision[],
  format: CompressionFormat,
): CompressedSection {
  switch (format) {
    case 'markdown':
      return renderMarkdown(scored);
    case 'h0c':
      return renderH0C(scored);
    case 'ultra':
      return renderUltra(scored);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// markdown — full fidelity
// ─────────────────────────────────────────────────────────────────────────────

function renderMarkdown(scored: readonly ScoredDecision[]): CompressedSection {
  const parts: string[] = [];
  for (const s of scored) {
    parts.push(renderFull(s.decision));
  }
  const body = parts.join('\n\n');
  return {
    title: 'Relevant Past Decisions',
    body,
    decisionCount: scored.length,
    estTokens: estimateTokens(body),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// h0c — tiered: full / title / grouped
// ─────────────────────────────────────────────────────────────────────────────

const H0C_FULL = 5;
const H0C_TITLES = 10;

function renderH0C(scored: readonly ScoredDecision[]): CompressedSection {
  const full = scored.slice(0, H0C_FULL);
  const titles = scored.slice(H0C_FULL, H0C_FULL + H0C_TITLES);
  const rest = scored.slice(H0C_FULL + H0C_TITLES);

  const lines: string[] = [];
  if (full.length > 0) {
    lines.push('### Top decisions');
    for (const s of full) lines.push(renderFull(s.decision));
  }
  if (titles.length > 0) {
    lines.push('\n### Other recent decisions');
    for (const s of titles)
      lines.push(`- ${s.decision.title} (confidence: ${s.decision.confidence})`);
  }
  if (rest.length > 0) {
    lines.push('\n### Related decisions (grouped)');
    for (const group of groupByTopTag(rest.map((s) => s.decision))) {
      lines.push(`- ${group.label}: ${group.count} decisions (${group.sampleTitles})`);
    }
  }

  const body = lines.join('\n');
  return {
    title: 'Relevant Past Decisions (H0C)',
    body,
    decisionCount: scored.length,
    estTokens: estimateTokens(body),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ultra — minimal
// ─────────────────────────────────────────────────────────────────────────────

const ULTRA_TITLES = 3;

function renderUltra(scored: readonly ScoredDecision[]): CompressedSection {
  const titles = scored.slice(0, ULTRA_TITLES);
  const rest = scored.slice(ULTRA_TITLES);

  const lines: string[] = [];
  if (titles.length > 0) {
    lines.push('### Top decisions (titles only)');
    for (const s of titles) lines.push(`- ${s.decision.title}`);
  }
  if (rest.length > 0) {
    lines.push('\n### Grouped summary');
    for (const group of groupByTopTag(rest.map((s) => s.decision))) {
      lines.push(`- ${group.label}: ${group.count}`);
    }
  }
  const body = lines.join('\n');
  return {
    title: 'Relevant Past Decisions (Ultra)',
    body,
    decisionCount: scored.length,
    estTokens: estimateTokens(body),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

export function estimateTokens(text: string): number {
  // Standard char/4 heuristic. Matches the provider-side countTokens.
  return Math.ceil(text.length / 4);
}

function renderFull(d: Decision): string {
  const tags = d.tags && d.tags.length > 0 ? ` _[${d.tags.join(', ')}]_` : '';
  return `#### ${d.title}\nConfidence: ${d.confidence}.${tags}\n${d.reasoning}`;
}

interface TagGroup {
  label: string;
  count: number;
  sampleTitles: string;
}

function groupByTopTag(decisions: readonly Decision[]): TagGroup[] {
  const byTag = new Map<string, Decision[]>();
  for (const d of decisions) {
    const tag = d.tags && d.tags.length > 0 ? (d.tags[0] ?? '(untagged)') : '(untagged)';
    const list = byTag.get(tag) ?? [];
    list.push(d);
    byTag.set(tag, list);
  }
  const groups: TagGroup[] = [];
  for (const [tag, list] of byTag) {
    const sample = list
      .slice(0, 3)
      .map((d) => `"${d.title}"`)
      .join(', ');
    const suffix = list.length > 3 ? `, +${list.length - 3} more` : '';
    groups.push({ label: tag, count: list.length, sampleTitles: sample + suffix });
  }
  // Larger groups first so the most important grouping appears at top.
  groups.sort((a, b) => b.count - a.count);
  return groups;
}
