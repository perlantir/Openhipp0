/**
 * LlmCheck — verifies that LLM providers have API keys configured and
 * (optionally) respond to a lightweight ping.
 *
 * Severity rules:
 *   - Empty providers list → 'fail' (system can't make any LLM calls).
 *   - All providers healthy → 'ok'.
 *   - Some providers unhealthy, primary unhealthy → 'fail'.
 *   - Some providers unhealthy, primary healthy (or no primary set) → 'warn'.
 *   - All providers unhealthy → 'fail'.
 */

import type { HealthCheck, HealthCheckOutput, HealthStatus } from '../types.js';

export interface LlmProviderProbe {
  name: string;
  /** Whether this provider has its API key configured. */
  hasApiKey: () => boolean;
  /** Optional live ping. Production may omit (key presence is often enough). */
  ping?: () => Promise<void> | void;
}

export interface LlmCheckOptions {
  providers: readonly LlmProviderProbe[];
  /** Provider name considered the primary. If primary fails → status='fail'. */
  primary?: string;
  /** Override the default check name. */
  name?: string;
}

interface ProviderResult {
  name: string;
  ok: boolean;
  reason?: string;
}

export class LlmCheck implements HealthCheck {
  readonly name: string;
  readonly description = 'LLM providers have API keys and respond to a ping';
  readonly category = 'connectivity';

  constructor(private readonly opts: LlmCheckOptions) {
    this.name = opts.name ?? 'llm';
  }

  async run(): Promise<HealthCheckOutput> {
    if (this.opts.providers.length === 0) {
      return { status: 'fail', message: 'No LLM providers configured' };
    }

    const results: ProviderResult[] = [];
    for (const p of this.opts.providers) {
      results.push(await probe(p));
    }

    const failed = results.filter((r) => !r.ok);
    if (failed.length === 0) {
      return { status: 'ok', details: { providers: results } };
    }

    const okCount = results.length - failed.length;
    const primaryFailed =
      this.opts.primary !== undefined && failed.some((r) => r.name === this.opts.primary);
    const status: HealthStatus = primaryFailed || okCount === 0 ? 'fail' : 'warn';
    return {
      status,
      message: `${failed.length}/${results.length} provider(s) unhealthy`,
      details: { providers: results, primaryFailed },
    };
  }
}

async function probe(p: LlmProviderProbe): Promise<ProviderResult> {
  if (!p.hasApiKey()) {
    return { name: p.name, ok: false, reason: 'missing_api_key' };
  }
  if (!p.ping) {
    return { name: p.name, ok: true };
  }
  try {
    await p.ping();
    return { name: p.name, ok: true };
  } catch (err) {
    return {
      name: p.name,
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
