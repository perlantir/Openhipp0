/**
 * Tag normalization + matching.
 *
 * Tags drive one of the five signals in the context compiler's scoring. They
 * need light stemming so "database", "databases", "databasing" collapse. A
 * full Porter implementation is overkill — we strip a handful of common
 * English suffixes (order matters). For CJK / other scripts, the normalizer
 * falls back to lowercased identity, which is still useful.
 *
 * Matching is set-based: the Jaccard overlap between two tag sets, with the
 * normalizer applied beforehand.
 */

/**
 * Ordered suffix-strip rules. Applied left-to-right; first match wins.
 * Each rule replaces the suffix with the given replacement.
 *
 * We intentionally omit a raw `es$ → ''` rule: it turns `databases` into
 * `databas` (wrong) and `processes` into `process` (correct only by luck).
 * The simpler `s$` rule covers most plurals correctly and the `sses$` /
 * `ies$` special cases handle the awkward ones.
 */
const SUFFIX_RULES: readonly [RegExp, string][] = [
  [/ies$/, 'y'], //    'companies' → 'company'
  [/sses$/, 'ss'], //  'classes'   → 'class', 'processes' → 'process'
  [/ied$/, 'y'], //    'tried'     → 'try'
  [/ing$/, ''], //     'running'   → 'runn'
  [/edly$/, ''], //    'markedly'  → 'mark'
  [/ed$/, ''], //      'worked'    → 'work'
  [/ly$/, ''], //      'quickly'   → 'quick'
  [/s$/, ''], //       'cats' → 'cat', 'databases' → 'database'
];

/**
 * Minimum stem length after stripping. Stripping down to 1–2 characters
 * produces garbage ('is' → 'i'); we reject any stem shorter than this and
 * keep the original.
 */
const MIN_STEM_LEN = 3;

/** Normalize a single tag: lowercase, trim, stem. Returns '' for empty. */
export function normalizeTag(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower.length === 0) return '';
  // Only apply English stemming for ASCII-ish words (leave other scripts alone).
  if (!/^[a-z][a-z0-9-]*$/.test(lower)) return lower;
  for (const [pattern, replacement] of SUFFIX_RULES) {
    if (pattern.test(lower)) {
      const stemmed = lower.replace(pattern, replacement);
      return stemmed.length >= MIN_STEM_LEN ? stemmed : lower;
    }
  }
  return lower;
}

/** Normalize an array of tags; dedupes and drops empties. */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const t of tags) {
    const n = normalizeTag(t);
    if (n) seen.add(n);
  }
  return [...seen];
}

/**
 * Jaccard similarity of two tag sets, after normalization.
 * Returns 0 for empty intersections, 1 for identical sets.
 */
export function tagSimilarity(a: readonly string[], b: readonly string[]): number {
  const na = new Set(normalizeTags(a));
  const nb = new Set(normalizeTags(b));
  if (na.size === 0 && nb.size === 0) return 0;

  let intersection = 0;
  for (const t of na) {
    if (nb.has(t)) intersection++;
  }
  const union = na.size + nb.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Count of normalized tags in `a` that appear (normalized) in `b`. */
export function tagOverlapCount(a: readonly string[], b: readonly string[]): number {
  const nb = new Set(normalizeTags(b));
  let n = 0;
  for (const t of normalizeTags(a)) {
    if (nb.has(t)) n++;
  }
  return n;
}
