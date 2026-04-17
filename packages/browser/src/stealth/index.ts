export {
  buildInitScript,
  DEFAULT_CHROME_LINUX,
  DEFAULT_CHROME_MAC,
  DEFAULT_CHROME_WIN,
  estimateEntropy,
  seedOf,
} from './fingerprint-v2.js';
export { humanMouseCurve, humanScrollProfile, readingPauseMs } from './behavior-engine.js';
export { ProxyRotator, type NextContext } from './proxy-rotation.js';
export type {
  FingerprintDescriptor,
  FingerprintEntropyEstimate,
  MouseCurvePoint,
  ProxyEntry,
  ProxyRotationStrategy,
  ProxyRotatorState,
  ReadingPauseInput,
} from './types.js';
