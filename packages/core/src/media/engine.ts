/**
 * MediaEngine — unified entry point for transcription, TTS, image generation,
 * and vision. Providers are injected; the engine picks the first available
 * for each capability. Bridge glue-code (telegram/discord/whatsapp) calls the
 * engine rather than talking to providers directly.
 */

import {
  Hipp0MediaError,
  type ImageGenerationInput,
  type ImageGenerationProvider,
  type ImageGenerationResult,
  type TranscribeOptions,
  type TranscriptionInput,
  type TranscriptionProvider,
  type TranscriptionResult,
  type TtsInput,
  type TtsProvider,
  type TtsResult,
  type VisionDescribeInput,
  type VisionDescribeResult,
  type VisionProvider,
} from './types.js';

export interface MediaEngineConfig {
  transcription?: readonly TranscriptionProvider[];
  tts?: readonly TtsProvider[];
  imageGeneration?: readonly ImageGenerationProvider[];
  vision?: readonly VisionProvider[];
}

export class MediaEngine {
  constructor(private readonly config: MediaEngineConfig = {}) {}

  hasTranscription(): boolean {
    return (this.config.transcription?.length ?? 0) > 0;
  }
  hasTts(): boolean {
    return (this.config.tts?.length ?? 0) > 0;
  }
  hasImageGeneration(): boolean {
    return (this.config.imageGeneration?.length ?? 0) > 0;
  }
  hasVision(): boolean {
    return (this.config.vision?.length ?? 0) > 0;
  }

  async transcribe(input: TranscriptionInput, opts?: TranscribeOptions): Promise<TranscriptionResult> {
    return withFallback(
      this.config.transcription,
      (p) => p.transcribe(input, opts),
      'transcription',
    );
  }

  async synthesize(input: TtsInput): Promise<TtsResult> {
    return withFallback(this.config.tts, (p) => p.synthesize(input), 'tts');
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    return withFallback(
      this.config.imageGeneration,
      (p) => p.generate(input),
      'image-generation',
    );
  }

  async describeImage(input: VisionDescribeInput): Promise<VisionDescribeResult> {
    return withFallback(this.config.vision, (p) => p.describe(input), 'vision');
  }
}

async function withFallback<P extends { name: string }, R>(
  providers: readonly P[] | undefined,
  run: (p: P) => Promise<R>,
  capability: string,
): Promise<R> {
  if (!providers || providers.length === 0) {
    throw new Hipp0MediaError(
      'HIPP0_MEDIA_NO_PROVIDER',
      `No ${capability} provider registered`,
    );
  }
  let lastErr: unknown;
  for (const p of providers) {
    try {
      return await run(p);
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Hipp0MediaError(
    'HIPP0_MEDIA_ALL_PROVIDERS_FAILED',
    `All ${capability} providers failed; last: ${String(lastErr)}`,
    { cause: lastErr },
  );
}
