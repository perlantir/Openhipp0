// Health system barrel — re-exports everything ergonomic from this folder.
//
// Phase 4b-i ships the framework (types + registry) and 4 connectivity-class
// checks (config / database / llm / bridges). Phase 4b-ii adds the resource-
// class checks (disk / memory / docker / ports) and a daemon mode.

export * from './types.js';
export { HealthRegistry } from './registry.js';
export type { HealthRegistryOptions } from './registry.js';
export { ConfigCheck } from './checks/config.js';
export type { ConfigCheckOptions } from './checks/config.js';
export { DatabaseCheck } from './checks/db.js';
export type { DatabaseCheckOptions } from './checks/db.js';
export { LlmCheck } from './checks/llm.js';
export type { LlmCheckOptions, LlmProviderProbe } from './checks/llm.js';
export { BridgesCheck } from './checks/bridges.js';
export type { BridgesCheckOptions, BridgeProbe } from './checks/bridges.js';
