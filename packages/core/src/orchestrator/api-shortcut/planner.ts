/**
 * Heuristic API-shortcut planner.
 *
 * Scoring inputs (conservative — false positives are expensive here;
 * calling the wrong endpoint hurts worse than an extra UI click):
 *
 *   - verb alignment: submit / save / create / delete → POST / PUT /
 *     PATCH / DELETE. View / search / list → GET.
 *   - path resemblance: the UI intent's target or description names a
 *     resource; the API path includes that resource name.
 *   - occurrence frequency: an endpoint called repeatedly in this
 *     session is more likely the right one.
 *   - exclusion: static-asset endpoints (.js/.css/.png…) never
 *     match, even at high confidence.
 */

import type {
  ObservedApiCall,
  PlannerInput,
  PlannerOutput,
  UiActionIntent,
  ApiShortcut,
} from './types.js';

const STATIC_ASSET_RE = /\.(?:js|css|png|jpg|jpeg|svg|gif|ico|woff2?|ttf|map)$/i;

function inferExpectedVerb(intent: UiActionIntent): string {
  const d = intent.description.toLowerCase();
  if (/\b(submit|save|create|sign ?up|register|add)\b/.test(d)) return 'POST';
  if (/\b(update|edit|rename|change)\b/.test(d)) return 'PATCH';
  if (/\b(delete|remove|cancel)\b/.test(d)) return 'DELETE';
  if (/\b(replace|put)\b/.test(d)) return 'PUT';
  return 'GET';
}

function extractResourceTokens(intent: UiActionIntent): Set<string> {
  const base = `${intent.description} ${intent.target ?? ''}`.toLowerCase();
  const tokens = base.match(/[a-z]{4,}/g) ?? [];
  return new Set(tokens);
}

function pathResourceTokens(path: string): Set<string> {
  return new Set(
    path
      .toLowerCase()
      .split('/')
      .flatMap((seg) => seg.split(/[^a-z0-9]+/))
      .filter((seg) => seg.length >= 4),
  );
}

function scoreCandidate(intent: UiActionIntent, cand: ObservedApiCall): { score: number; reason: string } {
  // Exclude malformed URLs + static assets hard.
  let urlHost = '';
  let urlPath = '';
  try {
    const u = new URL(cand.urlPattern);
    urlHost = u.host;
    urlPath = u.pathname;
  } catch {
    return { score: 0, reason: 'malformed urlPattern' };
  }
  if (STATIC_ASSET_RE.test(urlPath)) return { score: 0, reason: 'static asset' };

  // Host mismatch zeros the score — we never propose calling a different
  // origin than the one the agent's UI intent is scoped to. Prevents
  // accidentally shortcutting through a CDN or third-party analytics host.
  if (intent.host && urlHost && urlHost !== intent.host) {
    return { score: 0, reason: `host mismatch (${urlHost} vs intent ${intent.host})` };
  }

  const expectedVerb = inferExpectedVerb(intent);
  const verbMatch = cand.method.toUpperCase() === expectedVerb ? 1 : 0;
  if (verbMatch === 0) return { score: 0, reason: `verb mismatch (${cand.method} vs ${expectedVerb})` };

  const intentTokens = extractResourceTokens(intent);
  const pathTokens = pathResourceTokens(urlPath);
  // Substring match catches singular/plural drift (intent "user" → path "users").
  const shared = [...intentTokens].filter((it) =>
    [...pathTokens].some((pt) => pt.includes(it) || it.includes(pt)),
  ).length;
  const pathComponents = pathTokens.size || 1;
  const pathOverlap = Math.min(1, shared / pathComponents); // 0..1

  const hasJsonBody =
    typeof cand.contentType === 'string' && cand.contentType.includes('json');

  const frequency = Math.min(1, cand.occurrences / 5); // saturates at 5 uses

  // Weighted sum. Path overlap is the biggest signal.
  const score = pathOverlap * 0.6 + frequency * 0.2 + (hasJsonBody ? 0.2 : 0);
  return {
    score,
    reason: `verb=${verbMatch}, overlap=${pathOverlap.toFixed(2)}, freq=${frequency.toFixed(2)}, json=${hasJsonBody ? 1 : 0}`,
  };
}

export function proposeShortcut(input: PlannerInput): PlannerOutput {
  const minOcc = input.minOccurrences ?? 1;
  const minConf = input.minConfidence ?? 0.6;
  const evaluated: Array<{ candidate: ObservedApiCall; score: number; reason: string }> = [];
  for (const cand of input.observed) {
    if (cand.occurrences < minOcc) {
      evaluated.push({ candidate: cand, score: 0, reason: 'below minOccurrences' });
      continue;
    }
    const { score, reason } = scoreCandidate(input.intent, cand);
    evaluated.push({ candidate: cand, score, reason });
  }
  evaluated.sort((a, b) => b.score - a.score);
  const best = evaluated[0];
  if (!best || best.score < minConf) {
    return { shortcut: null, evaluated };
  }
  const shortcut: ApiShortcut = {
    method: best.candidate.method.toUpperCase(),
    urlPattern: best.candidate.urlPattern,
    confidence: Number(best.score.toFixed(3)),
    reason: best.reason,
    ...(best.candidate.requestBodySample ? { bodyHint: best.candidate.requestBodySample } : {}),
  };
  return { shortcut, evaluated };
}
