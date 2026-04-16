/**
 * Watchdog public types, configuration shapes, error hierarchy, and event payloads.
 *
 * Phase 4 design constraint: in-process. The state-snapshot schema below is the
 * stable contract for any *out-of-process* restart manager (Phase 7+ sidecar /
 * systemd unit / Docker entry shim) that wants to read what we persisted —
 * which is why it lives here as a Zod schema with an explicit version literal,
 * not buried inside the snapshot store.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// Memory pressure
// ─────────────────────────────────────────────────────────────────────────────

export type PressureLevel = 'warn' | 'critical' | 'fatal';

export interface MemoryThresholds {
  /** Fraction of V8 heap_size_limit at which 'warn' fires. Default 0.70. */
  warn: number;
  /** Fraction at which 'critical' fires. Default 0.85. */
  critical: number;
  /** Fraction at which 'fatal' fires (and the watchdog trips safe mode). Default 0.95. */
  fatal: number;
}

export const DEFAULT_MEMORY_THRESHOLDS: Readonly<MemoryThresholds> = Object.freeze({
  warn: 0.7,
  critical: 0.85,
  fatal: 0.95,
});

export interface HeapSample {
  usedBytes: number;
  limitBytes: number;
  /** usedBytes / limitBytes; 0 if limitBytes is 0. */
  fraction: number;
  /** Unix epoch milliseconds. */
  takenAt: number;
}

/** Pluggable heap source — production uses v8.getHeapStatistics; tests inject. */
export type HeapSource = () => HeapSample;

export interface HeapMonitorConfig {
  thresholds?: Partial<MemoryThresholds>;
  /** Sampling period in ms. Default 5_000. */
  intervalMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// GC thrashing
// ─────────────────────────────────────────────────────────────────────────────

export interface GcThrashConfig {
  /** Sliding-window length in ms. Default 10_000. */
  windowMs?: number;
  /** Fraction of window time spent in GC that trips the alert. Default 0.30. */
  thrashFraction?: number;
}

export interface GcEntry {
  /** Unix epoch ms when the GC entry was observed. */
  startTime: number;
  /** GC pause duration in ms. */
  duration: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Crash loop
// ─────────────────────────────────────────────────────────────────────────────

export interface CrashLoopConfig {
  /** Number of uncaught events in window that trips safe mode. Default 5. */
  threshold?: number;
  /** Sliding window in ms. Default 60_000. */
  windowMs?: number;
}

export type UncaughtKind = 'exception' | 'rejection';

// ─────────────────────────────────────────────────────────────────────────────
// State snapshot — public schema (out-of-process restart contract)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bumped on breaking shape changes. Loaders MUST refuse unknown values.
 *
 * Contract guarantees (don't break without a major bump):
 *   - `version` is a literal integer; no string forms.
 *   - `savedAt` is ISO-8601 UTC.
 *   - `lastSafeModeAt` is ISO-8601 UTC or null.
 *   - `custom` is an opaque map; producers and consumers agree out-of-band.
 */
export const SNAPSHOT_VERSION = 1 as const;

export const StateSnapshotSchema = z.object({
  version: z.literal(SNAPSHOT_VERSION),
  savedAt: z.string().min(1),
  pid: z.number().int().nonnegative(),
  uptimeSeconds: z.number().nonnegative(),
  sessionsActive: z.number().int().nonnegative().default(0),
  recentDecisionIds: z.array(z.string()).default([]),
  lastSafeModeAt: z.string().nullable().default(null),
  custom: z.record(z.unknown()).default({}),
});

export type StateSnapshot = z.infer<typeof StateSnapshotSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Top-level config + event payloads
// ─────────────────────────────────────────────────────────────────────────────

export interface WatchdogConfig {
  heap?: HeapMonitorConfig;
  gc?: GcThrashConfig;
  crashLoop?: CrashLoopConfig;
  /** Filesystem path for state snapshots. Default: `~/.hipp0/watchdog/snapshot.json`. */
  snapshotPath?: string;
}

/**
 * Event-name → payload contract for the Watchdog event bus. The runtime
 * EventEmitter doesn't enforce this type (Node EventEmitter is untyped), but
 * external consumers should treat this as the authoritative shape.
 */
export interface WatchdogEvents {
  memory_pressure: { level: PressureLevel; sample: HeapSample };
  gc_thrashing: { fraction: number; windowMs: number; gcMs: number };
  uncaught_exception: { kind: UncaughtKind; error: unknown };
  crash_loop: { count: number; windowMs: number };
  safe_mode_entered: { reason: string; at: number };
  pre_shutdown: { reason: string; at: number };
  snapshot_saved: { path: string; at: number };
  snapshot_save_failed: { path: string; error: unknown };
}

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class Hipp0WatchdogError extends Error {
  readonly code: string;
  constructor(message: string, code = 'HIPP0_WATCHDOG_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class Hipp0SnapshotCorruptError extends Hipp0WatchdogError {
  readonly path: string;
  override readonly cause: unknown;
  constructor(path: string, cause: unknown) {
    super(`Snapshot at ${path} is corrupt or unreadable`, 'HIPP0_SNAPSHOT_CORRUPT');
    this.path = path;
    this.cause = cause;
  }
}

export class Hipp0SafeModeError extends Hipp0WatchdogError {
  readonly reason: string;
  constructor(reason: string) {
    super(`Watchdog tripped safe mode: ${reason}`, 'HIPP0_SAFE_MODE');
    this.reason = reason;
  }
}
