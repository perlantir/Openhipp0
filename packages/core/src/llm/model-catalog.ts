/**
 * Model catalog — price + EOL metadata for the providers we support.
 *
 * Hot-swap hardening:
 *   - `costRatio(current, next)` lets the hot-swap route enforce a
 *     budget guardrail: if the new model is >1.5× the current per-token
 *     cost, the PATCH body MUST include an explicit acknowledgment flag.
 *   - `isDeprecated(provider, model)` is checked before accepting a
 *     `reloadConfig` swap — no one can accidentally pin to an EOL'd model.
 */

import type { ProviderConfig } from './types.js';

export interface ModelRecord {
  readonly provider: 'anthropic' | 'openai' | 'ollama';
  readonly model: string;
  /** USD per million input tokens. */
  readonly inputPerMTokUsd: number;
  /** USD per million output tokens. */
  readonly outputPerMTokUsd: number;
  /** ISO-date string the model is scheduled for end-of-life. null = evergreen. */
  readonly eolDate: string | null;
  /** Upstream deprecation notice URL. */
  readonly eolNotice?: string;
}

/**
 * Catalog is ordered by (provider, price ascending). Update as upstream
 * pricing changes; downstream tests pin to this list so changes land
 * deliberately.
 */
export const MODEL_CATALOG: readonly ModelRecord[] = [
  // Anthropic
  { provider: 'anthropic', model: 'claude-haiku-4-5', inputPerMTokUsd: 1, outputPerMTokUsd: 5, eolDate: null },
  { provider: 'anthropic', model: 'claude-sonnet-4-5', inputPerMTokUsd: 3, outputPerMTokUsd: 15, eolDate: null },
  { provider: 'anthropic', model: 'claude-sonnet-4-6', inputPerMTokUsd: 3, outputPerMTokUsd: 15, eolDate: null },
  { provider: 'anthropic', model: 'claude-opus-4-6', inputPerMTokUsd: 15, outputPerMTokUsd: 75, eolDate: null },
  { provider: 'anthropic', model: 'claude-opus-4-7', inputPerMTokUsd: 15, outputPerMTokUsd: 75, eolDate: null },
  // Openai
  { provider: 'openai', model: 'gpt-4o-mini', inputPerMTokUsd: 0.15, outputPerMTokUsd: 0.6, eolDate: null },
  { provider: 'openai', model: 'gpt-4o', inputPerMTokUsd: 2.5, outputPerMTokUsd: 10, eolDate: null },
  // Ollama (local — zero marginal cost).
  { provider: 'ollama', model: 'llama3', inputPerMTokUsd: 0, outputPerMTokUsd: 0, eolDate: null },
  { provider: 'ollama', model: 'mistral', inputPerMTokUsd: 0, outputPerMTokUsd: 0, eolDate: null },
];

export function lookupModel(
  provider: ProviderConfig['type'],
  model: string,
): ModelRecord | undefined {
  return MODEL_CATALOG.find((m) => m.provider === provider && m.model === model);
}

/**
 * Ratio of (new cost) / (current cost). We use a 0.25/0.75 weighted
 * average of input vs output to bias toward generation cost (the usual
 * majority in agent loops). Unknown models → returns +Infinity so callers
 * treat the swap as risky.
 */
export function costRatio(current: ProviderConfig, next: ProviderConfig): number {
  const cur = lookupModel(current.type, current.model);
  const nxt = lookupModel(next.type, next.model);
  if (!cur || !nxt) return Number.POSITIVE_INFINITY;
  const w = (inp: number, out: number): number => 0.25 * inp + 0.75 * out;
  const curTotal = w(cur.inputPerMTokUsd, cur.outputPerMTokUsd);
  if (curTotal === 0) return nxt.inputPerMTokUsd + nxt.outputPerMTokUsd > 0 ? Number.POSITIVE_INFINITY : 1;
  const nxtTotal = w(nxt.inputPerMTokUsd, nxt.outputPerMTokUsd);
  return nxtTotal / curTotal;
}

/** True when the model is past its scheduled EOL OR within 30 days of it. */
export function isNearEol(
  provider: ProviderConfig['type'],
  model: string,
  now: number = Date.now(),
): boolean {
  const rec = lookupModel(provider, model);
  if (!rec || !rec.eolDate) return false;
  const eolMs = Date.parse(rec.eolDate);
  if (Number.isNaN(eolMs)) return false;
  const msPerDay = 24 * 60 * 60 * 1000;
  return now >= eolMs - 30 * msPerDay;
}

export function isDeprecated(
  provider: ProviderConfig['type'],
  model: string,
  now: number = Date.now(),
): boolean {
  const rec = lookupModel(provider, model);
  if (!rec || !rec.eolDate) return false;
  return now >= Date.parse(rec.eolDate);
}
