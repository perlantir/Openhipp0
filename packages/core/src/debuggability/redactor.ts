/**
 * Secret redaction for debug bundles.
 *
 * Replaces sensitive patterns with `<REDACTED:kind>`. Catches:
 *   - API keys (sk-..., sk_live_..., sk_test_..., xoxb-..., xoxp-...)
 *   - Bearer tokens (Authorization: Bearer <token>)
 *   - JWT-shaped tokens (three base64url segments joined by dots)
 *   - Generic-looking secrets (*_KEY=VALUE, *_TOKEN=VALUE in env-style text)
 *   - File paths that look like credential files (~/.ssh/*, ~/.aws/*, etc.)
 *
 * False-positives are acceptable — we err on the side of redacting too
 * much rather than leaking. Redacted kinds are labeled so operators can
 * sanity-check the bundle without having to re-read the full text.
 */

export interface RedactionRule {
  readonly kind: string;
  readonly pattern: RegExp;
  /** Replace the full match (true) or the first capture group (false). Default: true. */
  readonly replaceWhole?: boolean;
}

export const DEFAULT_REDACTION_RULES: readonly RedactionRule[] = [
  { kind: 'anthropic-key', pattern: /sk-ant-[a-zA-Z0-9_-]+/g },
  { kind: 'openai-key', pattern: /sk-(?:proj-)?[a-zA-Z0-9_-]{24,}/g },
  { kind: 'stripe-key', pattern: /sk_(?:live|test)_[a-zA-Z0-9_-]{24,}/g },
  { kind: 'slack-bot-token', pattern: /xox[abp]-[a-zA-Z0-9-]+/g },
  { kind: 'bearer-token', pattern: /Bearer\s+([a-zA-Z0-9._-]+)/gi, replaceWhole: false },
  { kind: 'jwt', pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g },
  { kind: 'github-token', pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'ssh-key-path', pattern: /~\/\.ssh\/[a-zA-Z0-9_.-]+/g },
  { kind: 'aws-path', pattern: /~\/\.aws\/[a-zA-Z0-9_.-]+/g },
  { kind: 'env-secret', pattern: /(?<=[A-Z][A-Z0-9_]*(?:_KEY|_TOKEN|_SECRET|_PASSWORD)=)([^\s"']+)/g, replaceWhole: false },
];

export interface RedactionOptions {
  readonly rules?: readonly RedactionRule[];
  /** Additional allow-list of literal substrings to hide. */
  readonly extraLiterals?: readonly string[];
}

export function redactSecrets(text: string, opts: RedactionOptions = {}): string {
  let out = text;
  const rules = opts.rules ?? DEFAULT_REDACTION_RULES;
  for (const rule of rules) {
    out = out.replace(rule.pattern, (match, ...groups: unknown[]) => {
      if (rule.replaceWhole === false) {
        const g1 = groups[0];
        if (typeof g1 === 'string') {
          return match.replace(g1, `<REDACTED:${rule.kind}>`);
        }
      }
      return `<REDACTED:${rule.kind}>`;
    });
  }
  for (const literal of opts.extraLiterals ?? []) {
    if (!literal) continue;
    out = out.split(literal).join('<REDACTED:literal>');
  }
  return out;
}

/** Redact a JSON-serializable value in place. Returns a redacted deep clone. */
export function redactJson(value: unknown, opts: RedactionOptions = {}): unknown {
  if (typeof value === 'string') return redactSecrets(value, opts);
  if (Array.isArray(value)) return value.map((v) => redactJson(v, opts));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/(?:password|secret|token|api_?key)/i.test(k)) {
        out[k] = '<REDACTED:field>';
      } else {
        out[k] = redactJson(v, opts);
      }
    }
    return out;
  }
  return value;
}
