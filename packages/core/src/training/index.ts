/**
 * @openhipp0/core training — trajectory export + batch runner + compression.
 *
 * Phase 15. Downstream pipelines (axolotl, transformers, Atropos) can
 * consume the JSONL output directly; see docs/training-data.md for the
 * recommended fine-tuning workflow.
 */

export * from './types.js';
export { toJsonl, fromJsonl, toSftExamples, toDpoExamples, toAtropos } from './export.js';
export type {
  ToSftOptions,
  ToDpoOptions,
  AtroposStep,
  AtroposTrajectory,
} from './export.js';
export { compressTrajectory } from './compress.js';
export type { CompressOptions } from './compress.js';
export {
  runBatch,
  createMemoryCheckpointStore,
} from './batch-runner.js';
export type {
  Task,
  BatchCheckpoint,
  CheckpointStore,
  BatchRunnerOptions,
  BatchRunnerResult,
} from './batch-runner.js';
