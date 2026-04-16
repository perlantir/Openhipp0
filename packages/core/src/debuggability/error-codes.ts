/**
 * Structured error-code registry — HIPP0-XXXX.
 *
 * Every structured code carries { message template, fix hint, docs URL }.
 * Shipping this at launch lets users paste an error code and get
 * actionable guidance without having to grep source. The existing
 * `Hipp0Error.code` values are kept verbatim; the registry maps them to
 * the four-digit HIPP0-XXXX shorthand + metadata.
 */

export interface ErrorCodeMetadata {
  /** Underlying Hipp0Error.code (`HIPP0_BUDGET_EXCEEDED` etc.). */
  readonly code: string;
  /** Four-digit external identifier (`HIPP0-0004`). */
  readonly externalCode: string;
  /** Short category — used for grouping + dashboard filters. */
  readonly category:
    | 'llm'
    | 'tool'
    | 'security'
    | 'memory'
    | 'watchdog'
    | 'marketplace'
    | 'backup'
    | 'skill'
    | 'cli'
    | 'bridge'
    | 'scheduler'
    | 'enterprise'
    | 'generic';
  /** What typically causes this error. */
  readonly cause: string;
  /** How to fix. Terse, actionable. */
  readonly fix: string;
  /** Canonical docs URL for deep-dive. */
  readonly docsUrl: string;
}

const REGISTRY: readonly ErrorCodeMetadata[] = [
  {
    code: 'HIPP0_BUDGET_EXCEEDED',
    externalCode: 'HIPP0-0004',
    category: 'llm',
    cause: 'Daily LLM spend exceeded the configured limit.',
    fix: 'Raise `config.budget.dailyLimitUsd` or wait for the rolling 24h window to reset.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0004',
  },
  {
    code: 'HIPP0_CIRCUIT_OPEN',
    externalCode: 'HIPP0-0005',
    category: 'llm',
    cause: 'Provider circuit breaker has tripped after repeated failures.',
    fix: 'Wait `retryAfterMs` or swap to a healthy provider in the failover chain.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0005',
  },
  {
    code: 'HIPP0_ALL_PROVIDERS_FAILED',
    externalCode: 'HIPP0-0006',
    category: 'llm',
    cause: 'Every configured LLM provider failed on the same call.',
    fix: 'Check provider API keys + network egress; check each providerError in the details.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0006',
  },
  {
    code: 'HIPP0_RETRY_EXHAUSTED',
    externalCode: 'HIPP0-0007',
    category: 'llm',
    cause: 'A retryable call failed N times in a row.',
    fix: 'Inspect `cause`; raise `config.retry.maxAttempts` if the root failure is transient.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0007',
  },
  {
    code: 'HIPP0_TIMEOUT',
    externalCode: 'HIPP0-0008',
    category: 'generic',
    cause: 'An operation exceeded its deadline.',
    fix: 'Raise the timeout or reduce input size.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0008',
  },
  {
    code: 'HIPP0_SKILL_NOT_FOUND',
    externalCode: 'HIPP0-0101',
    category: 'skill',
    cause: 'A skill was requested but no matching manifest was loaded.',
    fix: 'Run `hipp0 skill list` to confirm the skill is discoverable in workspace/global/builtin paths.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0101',
  },
  {
    code: 'HIPP0_SKILL_MANIFEST_INVALID',
    externalCode: 'HIPP0-0102',
    category: 'skill',
    cause: 'A skill manifest failed Zod validation at load time.',
    fix: 'Check `manifest.json` — run `hipp0 skill audit` for the per-file diagnostic.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0102',
  },
  {
    code: 'HIPP0_MARKETPLACE_HASH_MISMATCH',
    externalCode: 'HIPP0-0201',
    category: 'marketplace',
    cause: 'A fetched skill bundle does not match its published contentHash.',
    fix: 'Refuse the install. Report the bundle URL + publisher to the marketplace operator.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0201',
  },
  {
    code: 'HIPP0_MARKETPLACE_PINNED',
    externalCode: 'HIPP0-0202',
    category: 'marketplace',
    cause: 'Cannot install over a skill that is currently pinned.',
    fix: 'Run `hipp0 marketplace unpin <name>` before upgrading.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0202',
  },
  {
    code: 'HIPP0_BACKUP_DECRYPT_FAILED',
    externalCode: 'HIPP0-0301',
    category: 'backup',
    cause: 'Backup ciphertext failed AES-256-GCM decryption — wrong password or tampered blob.',
    fix: 'Verify HIPP0_BACKUP_PASSWORD matches the key used at create time. If tampered, restore from a different snapshot.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0301',
  },
  {
    code: 'HIPP0_BACKUP_CHECKSUM_MISMATCH',
    externalCode: 'HIPP0-0302',
    category: 'backup',
    cause: 'A decrypted blob does not match the manifest checksum.',
    fix: 'Do not apply the restore. Fetch a different snapshot or investigate for tampering.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0302',
  },
  {
    code: 'HIPP0_CLI_SKILL_BAD_NAME',
    externalCode: 'HIPP0-0401',
    category: 'cli',
    cause: 'Skill name contains characters outside [a-z0-9_-].',
    fix: 'Rename the skill to a lowercase slug before running the CLI command.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0401',
  },
  {
    code: 'HIPP0_CLI_CRON_INVALID_SCHEDULE',
    externalCode: 'HIPP0-0402',
    category: 'cli',
    cause: 'The supplied cron expression did not parse.',
    fix: 'Use 5-field cron or natural-language (e.g. "every 15 minutes"). See `hipp0 cron --help`.',
    docsUrl: 'https://docs.openhipp0.dev/errors/HIPP0-0402',
  },
];

const BY_CODE = new Map<string, ErrorCodeMetadata>();
const BY_EXTERNAL = new Map<string, ErrorCodeMetadata>();
for (const entry of REGISTRY) {
  BY_CODE.set(entry.code, entry);
  BY_EXTERNAL.set(entry.externalCode, entry);
}

export function describeError(codeOrExternal: string): ErrorCodeMetadata | undefined {
  return BY_CODE.get(codeOrExternal) ?? BY_EXTERNAL.get(codeOrExternal);
}

export function listErrorCodes(): readonly ErrorCodeMetadata[] {
  return REGISTRY;
}

export function formatErrorLine(codeOrExternal: string): string {
  const meta = describeError(codeOrExternal);
  if (!meta) return `${codeOrExternal}: (no registry entry)`;
  return `${meta.externalCode} [${meta.category}] — ${meta.cause} · fix: ${meta.fix} · ${meta.docsUrl}`;
}
