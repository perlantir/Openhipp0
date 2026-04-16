// @openhipp0/watchdog — Self-healing engine: process watchdog, health checks,
// safe updates, predictive issue detection.
//
// Phase 4a — Process Watchdog:
//   - HeapMonitor / GcThrashDetector / CrashLoopDetector
//   - StateSnapshotStore (public-schema atomic snapshot)
//   - Watchdog (composer + event bus, in-process)
//
// Phase 4b-i — Health system framework + 4 connectivity checks:
//   - HealthRegistry, HealthCheck interface, HealthReport
//   - ConfigCheck, DatabaseCheck, LlmCheck, BridgesCheck
//
// Later sub-phases (4b-ii/4c/4d/4e) ship resource checks + daemon, safe
// updates, predictive detection, and integration wiring.

export const packageName = '@openhipp0/watchdog' as const;
export const version = '0.0.0' as const;

export * from './types.js';
export { HeapMonitor, defaultHeapSource } from './heap-monitor.js';
export { GcThrashDetector } from './gc-thrash.js';
export { CrashLoopDetector } from './crash-loop.js';
export { StateSnapshotStore } from './state-snapshot.js';
export type { SnapshotInput } from './state-snapshot.js';
export { Watchdog } from './watchdog.js';
export type { SnapshotProvider, WatchdogDeps } from './watchdog.js';

export * from './health/index.js';
export * from './update/index.js';
export {
  BreakerRegistry,
  CircuitBreaker,
  type BreakerEntry,
  type BreakerStateChange,
  type CircuitBreakerConfig,
  type CircuitState,
} from './breakers/registry.js';
export * from './predictor/index.js';
