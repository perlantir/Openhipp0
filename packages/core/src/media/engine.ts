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
  type MediaCostEvent,
  type MediaCostSink,
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

// OpenAI list prices as of 2026-04 — updated via PR when Anthropic/OpenAI ship
// new pricing. Callers that care about precision should pass their own
// `costSink` and compute from the raw units.
const PRICES = {
  whisper: 0.006 / 60, // USD per second ($0.006 / min)
  tts: 15 / 1_000_000, // USD per character ($15 / 1M chars, standard voice)
  ttsHd: 30 / 1_000_000, // USD per character, HD voice — bridge config can override
  dalle3Std: 0.04, // USD per 1024x1024 image (standard quality)
  gpt4oVisionInput: 2.5 / 1_000_000, // tokens, $2.50/M input
} as const;

export interface MediaEngineConfig {
  transcription?: readonly TranscriptionProvider[];
  tts?: readonly TtsProvider[];
  imageGeneration?: readonly ImageGenerationProvider[];
  vision?: readonly VisionProvider[];
  /** Called once per successful media call with units + USD estimate. */
  costSink?: MediaCostSink;
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
    const { result, provider } = await withFallback(
      this.config.transcription,
      (p) => p.transcribe(input, opts),
      'transcription',
    );
    const seconds = result.duration ?? 0;
    await this.emit({
      capability: 'transcription',
      provider,
      units: seconds,
      unitLabel: 'seconds',
      costUsd: provider.includes('whisper') ? seconds * PRICES.whisper : 0,
      timestamp: new Date().toISOString(),
    });
    return result;
  }

  async synthesize(input: TtsInput): Promise<TtsResult> {
    const { result, provider } = await withFallback(
      this.config.tts,
      (p) => p.synthesize(input),
      'tts',
    );
    const chars = input.text.length;
    const pricePer = provider.toLowerCase().includes('hd') ? PRICES.ttsHd : PRICES.tts;
    await this.emit({
      capability: 'tts',
      provider,
      units: chars,
      unitLabel: 'characters',
      costUsd: provider.toLowerCase().includes('openai') ? chars * pricePer : 0,
      timestamp: new Date().toISOString(),
    });
    return result;
  }

  async generateImage(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const { result, provider } = await withFallback(
      this.config.imageGeneration,
      (p) => p.generate(input),
      'image-generation',
    );
    // ImageGenerationResult is one image per call today; kept as a count so
    // future batch-image APIs can report >1 without changing the event shape.
    const images = 1;
    await this.emit({
      capability: 'image-generation',
      provider,
      units: images,
      unitLabel: 'images',
      costUsd: provider.toLowerCase().includes('dalle') ? images * PRICES.dalle3Std : 0,
      timestamp: new Date().toISOString(),
    });
    return result;
  }

  async describeImage(input: VisionDescribeInput): Promise<VisionDescribeResult> {
    const { result, provider } = await withFallback(
      this.config.vision,
      (p) => p.describe(input),
      'vision',
    );
    // Vision cost is the model's input-token surface — tests pass tokens when
    // they know; otherwise we emit 0 units and a 0 cost. Callers that need
    // exact billing should compute from their provider's usage report.
    const tokens = (result as { usage?: { inputTokens?: number } }).usage?.inputTokens ?? 0;
    await this.emit({
      capability: 'vision',
      provider,
      units: tokens,
      unitLabel: 'tokens',
      costUsd: tokens * PRICES.gpt4oVisionInput,
      timestamp: new Date().toISOString(),
    });
    return result;
  }

  private async emit(event: MediaCostEvent): Promise<void> {
    const sink = this.config.costSink;
    if (!sink) return;
    try {
      await sink(event);
    } catch {
      // Cost accounting must never fail a media call.
    }
  }
}

async function withFallback<P extends { name: string }, R>(
  providers: readonly P[] | undefined,
  run: (p: P) => Promise<R>,
  capability: string,
): Promise<{ result: R; provider: string }> {
  if (!providers || providers.length === 0) {
    throw new Hipp0MediaError(
      'HIPP0_MEDIA_NO_PROVIDER',
      `No ${capability} provider registered`,
    );
  }
  let lastErr: unknown;
  for (const p of providers) {
    try {
      const result = await run(p);
      return { result, provider: p.name };
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
