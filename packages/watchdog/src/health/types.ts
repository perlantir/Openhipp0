/**
 * Health-system public types.
 *
 * A HealthCheck is anything that can answer "is component X functional right
 * now?" with a structured result. Checks are stateless (each `run()` is
 * independent) and own their own dependencies (constructor-injected). The
 * registry composes them and produces a HealthReport.
 *
 * The optional `autoFix(lastOutput)` lets a check ship its own remediation
 * (e.g. reconnect a dropped DB pool). The registry calls autoFix only when
 * `run({ autoFix: true })` is requested AND the check came back non-ok.
 */

export type HealthStatus = 'ok' | 'warn' | 'fail' | 'skipped';

export interface HealthCheckOutput {
  status: HealthStatus;
  message?: string;
  details?: Record<string, unknown>;
}

export interface AutoFixResult {
  attempted: boolean;
  succeeded: boolean;
  description: string;
  error?: unknown;
}

export interface HealthCheckResult extends HealthCheckOutput {
  name: string;
  category?: string;
  /** Wall-clock time the check (and any autoFix) consumed, in ms. */
  durationMs: number;
  autoFix?: AutoFixResult;
}

export interface HealthReport {
  /** Unix epoch ms when the run started. */
  generatedAt: number;
  /** Wall-clock duration of the entire run. */
  totalDurationMs: number;
  /** Aggregate status: 'fail' if any fail, else 'warn' if any warn, else 'ok'. */
  overall: HealthStatus;
  summary: { ok: number; warn: number; fail: number; skipped: number };
  results: readonly HealthCheckResult[];
}

export interface HealthCheck {
  /** Stable identifier — must be unique within a registry. */
  readonly name: string;
  /** Short user-facing description shown by `hipp0 doctor`. */
  readonly description: string;
  /** Optional grouping tag (e.g. 'config', 'connectivity', 'resources'). */
  readonly category?: string;
  /** Per-check timeout (ms). Overrides the registry's global timeout. */
  readonly timeoutMs?: number;
  /** Run the check. Throwing is permitted — registry coerces to status='fail'. */
  run(): Promise<HealthCheckOutput>;
  /** Optional remediation. Called only when run() returned non-ok and the registry was asked to autoFix. */
  autoFix?(lastOutput: HealthCheckOutput): Promise<AutoFixResult>;
}

export interface HealthRunOptions {
  /** Invoke autoFix on each non-ok check that exposes one. Default false. */
  autoFix?: boolean;
  /** Only run checks whose `name` is in this list. */
  only?: readonly string[];
  /** Skip checks whose `name` is in this list. */
  skip?: readonly string[];
  /** Global per-check timeout (ms). Overridden by `check.timeoutMs`. Default 5_000. */
  timeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class Hipp0HealthError extends Error {
  readonly code: string;
  constructor(message: string, code = 'HIPP0_HEALTH_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class Hipp0DuplicateCheckError extends Hipp0HealthError {
  readonly checkName: string;
  constructor(checkName: string) {
    super(`Health check already registered: ${checkName}`, 'HIPP0_DUPLICATE_CHECK');
    this.checkName = checkName;
  }
}
