/**
 * @openhipp0/core media — voice transcription, TTS, image generation, vision.
 *
 * Phase 11. Providers are thin HTTP clients; the engine picks one by
 * capability and falls back down the list on failure.
 */

export * from './types.js';
export { MediaEngine } from './engine.js';
export type { MediaEngineConfig } from './engine.js';
export {
  transcribeVoiceAttachment,
  describeImageAttachment,
  enrichMessage,
} from './bridge-hooks.js';
export type { VoiceAttachment, ImageAttachment } from './bridge-hooks.js';
export { OpenAIWhisperProvider, WhisperCppProvider } from './providers/openai-whisper.js';
export type { OpenAIWhisperOptions, WhisperCppOptions } from './providers/openai-whisper.js';
export { OpenAITtsProvider, LocalTtsStub } from './providers/openai-tts.js';
export type { OpenAITtsOptions } from './providers/openai-tts.js';
// G5: voice expansion
export { EdgeTtsProvider, type EdgeTtsOptions } from './providers/edge-tts.js';
export { ElevenLabsTtsProvider, type ElevenLabsOptions } from './providers/elevenlabs-tts.js';
export { MiniMaxTtsProvider, type MiniMaxTtsOptions } from './providers/minimax-tts.js';
export { PiperTtsProvider, type PiperRunner, type PiperTtsOptions } from './providers/piper-tts.js';
export {
  ElevenLabsVoiceCloner,
  type ConsentRecord,
  type ElevenLabsCloneOptions,
  type EnrollVoiceInput,
  type VoiceCloningProvider,
} from './voice-cloning.js';
export { OpenAIImageProvider } from './providers/openai-image.js';
export type { OpenAIImageOptions } from './providers/openai-image.js';
export {
  ClaudeVisionProvider,
  OpenAIVisionProvider,
  LocalVisionStub,
} from './providers/vision.js';
export type { ClaudeVisionOptions, OpenAIVisionOptions } from './providers/vision.js';
// BFW-003: multimodal video/audio reasoning + HTML5 caption track parsing
export * as multimodal from './multimodal/index.js';
