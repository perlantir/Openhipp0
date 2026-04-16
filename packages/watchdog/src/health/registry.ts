/**
 * HealthRegistry — owns a set of HealthCheck instances and orchestrates a run.
 *
 * Concurrency: all checks run in parallel via Promise.all over a try/catch'd
 * runner, so one slow or failing check never blocks the others.
 *
 * Timeouts: each check has a deadline (per-check `timeoutMs` if set, else the
 * registry's global default). On timeout the result is reported as 'fail'; the
 * underlying promise is left to settle in the background — we don't have a
 * cancellation primitive in node, so it's the caller's job to keep `run()`
 * implementations responsive.
 *
 * AutoFix: only invoked when `run({ autoFix: true })` is requested AND the
 * primary `run()` returned non-ok AND the check exposes an `autoFix` method.
 * AutoFix errors are captured in the result, never re-thrown.
 */

import {
  type AutoFixResult,
  type HealthCheck,
  type HealthCheckOutput,
  type HealthCheckResult,
  type HealthReport,
  type HealthRunOptions,
  type HealthStatus,
  Hipp0DuplicateCheckError,
} from './types.js';

const DEFAULT_TIMEOUT_MS = 5_000;

export interface HealthRegistryOptions {
  /** Default per-check timeout. Default 5_000. */
  defaultTimeoutMs?: number;
}

export class HealthRegistry {
  private readonly checks = new Map<string, HealthCheck>();
  private readonly defaultTimeoutMs: number;

  constructor(opts: HealthRegistryOptions = {}) {
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Register a check. Throws Hipp0DuplicateCheckError on name collision. */
  register(check: HealthCheck): void {
    if (this.checks.has(check.name)) {
      throw new Hipp0DuplicateCheckError(check.name);
    }
    this.checks.set(check.name, check);
  }

  /** Returns true if a check with this name was removed. */
  unregister(name: string): boolean {
    return this.checks.delete(name);
  }

  has(name: string): boolean {
    return this.checks.has(name);
  }

  /** Snapshot of registered checks (insertion order). */
  list(): readonly HealthCheck[] {
    return [...this.checks.values()];
  }

  size(): number {
    return this.checks.size;
  }

  async run(opts: HealthRunOptions = {}): Promise<HealthReport> {
    const generatedAt = Date.now();
    const checks = this.filter(opts);
    const globalTimeoutMs = opts.timeoutMs ?? this.defaultTimeoutMs;
    const runAutoFix = opts.autoFix ?? false;

    const results = await Promise.all(
      checks.map((c) => this.runOne(c, globalTimeoutMs, runAutoFix)),
    );

    const summary = { ok: 0, warn: 0, fail: 0, skipped: 0 };
    for (const r of results) summary[r.status]++;
    const overall: HealthStatus = summary.fail > 0 ? 'fail' : summary.warn > 0 ? 'warn' : 'ok';

    return {
      generatedAt,
      totalDurationMs: Date.now() - generatedAt,
      overall,
      summary,
      results,
    };
  }

  private filter(opts: HealthRunOptions): HealthCheck[] {
    let list = [...this.checks.values()];
    if (opts.only) {
      const keep = new Set(opts.only);
      list = list.filter((c) => keep.has(c.name));
    }
    if (opts.skip) {
      const drop = new Set(opts.skip);
      list = list.filter((c) => !drop.has(c.name));
    }
    return list;
  }

  private async runOne(
    check: HealthCheck,
    globalTimeoutMs: number,
    runAutoFix: boolean,
  ): Promise<HealthCheckResult> {
    const start = Date.now();
    const timeoutMs = check.timeoutMs ?? globalTimeoutMs;

    let output: HealthCheckOutput;
    try {
      output = await withTimeout(check.run(), timeoutMs, check.name);
    } catch (err) {
      output = {
        status: 'fail',
        message: err instanceof Error ? err.message : String(err),
        details: { error: serializeError(err) },
      };
    }

    let autoFix: AutoFixResult | undefined;
    if (runAutoFix && output.status !== 'ok' && check.autoFix) {
      try {
        autoFix = await withTimeout(check.autoFix(output), timeoutMs, `${check.name}:autoFix`);
      } catch (err) {
        autoFix = {
          attempted: true,
          succeeded: false,
          description: `autoFix threw: ${err instanceof Error ? err.message : String(err)}`,
          error: err,
        };
      }
    }

    const result: HealthCheckResult = {
      name: check.name,
      ...output,
      durationMs: Date.now() - start,
    };
    if (check.category !== undefined) result.category = check.category;
    if (autoFix) result.autoFix = autoFix;
    return result;
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Health check '${label}' timed out after ${ms}ms`)),
      ms,
    );
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return err;
}
