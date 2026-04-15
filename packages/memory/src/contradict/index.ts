/**
 * Public surface of @openhipp0/memory/contradict.
 */

export {
  classifyStance,
  detectContradictions,
  detectContradictionsForText,
  recordContradictions,
  opposingConclusions,
  HARD_SIM_THRESHOLD,
  LLM_SIM_MIN,
  type ContradictionCandidate,
  type ContradictionClassifier,
  type DetectInput,
  type DetectOptions,
  type Stance,
} from './detect.js';
