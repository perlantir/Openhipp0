/**
 * Media types — voice, image generation, vision.
 *
 * Providers are injectable for tests. The MediaEngine selects a provider by
 * name; `local-stub` is always available as a deterministic fallback for
 * offline tests. Real providers (OpenAI Whisper/TTS/DALL-E/GPT-4o, Claude
 * vision) are thin wrappers over their HTTP APIs.
 */

export type TranscriptionInput =
  | { kind: 'buffer'; data: Uint8Array; filename: string; mimeType?: string }
  | { kind: 'path'; path: string; mimeType?: string };

/**
 * Emitted after each MediaEngine call so Phase 22 (cost optimization) can
 * bill audio minutes + TTS characters + image generations alongside LLM
 * tokens. `costUsd` is the caller's best estimate using the provider's
 * list prices; callers can leave it 0 when pricing is unknown and the
 * consumer computes it from raw units.
 */
export interface MediaCostEvent {
  capability: 'transcription' | 'tts' | 'image-generation' | 'vision';
  provider: string;
  /** Transcription: seconds of audio. TTS: characters. */
  units: number;
  unitLabel: 'seconds' | 'characters' | 'images' | 'tokens';
  costUsd: number;
  timestamp: string;
  /** Optional agent / session tag for attribution. */
  agentId?: string;
}

export type MediaCostSink = (event: MediaCostEvent) => void | Promise<void>;

export interface TranscriptionResult {
  text: string;
  /** ISO 639-1 code when the provider detects it. */
  language?: string;
  /** Seconds, when the provider reports it. */
  duration?: number;
  /** Provider-specific extras kept as-is for debugging. */
  raw?: unknown;
}

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(input: TranscriptionInput, opts?: TranscribeOptions): Promise<TranscriptionResult>;
}

export interface TranscribeOptions {
  /** Hint for the expected language (ISO 639-1). */
  language?: string;
  /** Prompt bias — words the provider should lean toward. */
  prompt?: string;
}

export interface TtsInput {
  text: string;
  voice?: string; // provider-specific (OpenAI: alloy, echo, fable, onyx, nova, shimmer)
  format?: 'mp3' | 'opus' | 'aac' | 'flac' | 'wav';
  speed?: number; // 0.25 – 4.0
}

export interface TtsResult {
  audio: Uint8Array;
  mimeType: string;
}

export interface TtsProvider {
  readonly name: string;
  synthesize(input: TtsInput): Promise<TtsResult>;
}

export interface ImageGenerationInput {
  prompt: string;
  size?: '1024x1024' | '1792x1024' | '1024x1792';
  quality?: 'standard' | 'hd';
  responseFormat?: 'url' | 'b64_json';
  style?: 'vivid' | 'natural';
}

export interface ImageGenerationResult {
  prompt: string;
  /** Present when responseFormat is 'url' (default). */
  url?: string;
  /** Present when responseFormat is 'b64_json'. */
  b64?: string;
  /** The prompt the provider actually used (DALL-E rewrites prompts). */
  revisedPrompt?: string;
}

export interface ImageGenerationProvider {
  readonly name: string;
  generate(input: ImageGenerationInput): Promise<ImageGenerationResult>;
}

export type VisionImage =
  | { kind: 'url'; url: string }
  | { kind: 'base64'; data: string; mimeType: string }
  | { kind: 'buffer'; data: Uint8Array; mimeType: string };

export interface VisionDescribeInput {
  images: readonly VisionImage[];
  /** The question or instruction to apply to the image(s). */
  question?: string;
  /** Model hint ('claude-sonnet-4', 'gpt-4o'). Ignored by stubs. */
  model?: string;
  /** JSON schema the caller wants the model to produce; when present the
   * description field holds a JSON stringified object matching the schema. */
  schema?: Record<string, unknown>;
}

export interface VisionDescribeResult {
  /** Plain-language description. */
  description: string;
  /** Structured extraction when a schema is requested; otherwise undefined. */
  structured?: Record<string, unknown>;
  /** The provider that handled the call. */
  provider: string;
}

export interface VisionProvider {
  readonly name: string;
  describe(input: VisionDescribeInput): Promise<VisionDescribeResult>;
}

export class Hipp0MediaError extends Error {
  readonly code: string;
  constructor(code: string, message: string, opts?: { cause?: unknown }) {
    super(message, opts);
    this.name = 'Hipp0MediaError';
    this.code = code;
  }
}
