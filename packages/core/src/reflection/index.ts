/**
 * Public surface of @openhipp0/core/reflection.
 */
export * from './types.js';
export { runRubric } from './rubric.js';
export {
  maybeCritique,
  buildRevisionInstruction,
  assessOutcomeAsync,
  type MaybeCritiqueInput,
  type CritiqueApplyDecision,
  type AsyncOutcomeInput,
} from './runtime-hook.js';
