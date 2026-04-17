/**
 * VideoReasoner — produces a structured summary of a video by:
 *   1. Extracting N evenly-spaced frames (default 8).
 *   2. Pulling an audio transcript (optional).
 *   3. Asking the multimodal client to describe each frame.
 *   4. Combining into an ordered evidence list + asking for summary.
 */

import type {
  AudioSegment,
  MediaDecoder,
  MultimodalClient,
  StepEvidence,
  VideoFrame,
} from './types.js';

export interface ReasonVideoInput {
  readonly videoBytes: Uint8Array;
  readonly prompt: string;
  readonly frameCount?: number;
  readonly includeAudio?: boolean;
  readonly language?: string;
}

export interface ReasonVideoResult {
  readonly summary: string;
  readonly evidence: readonly StepEvidence[];
}

export class VideoReasoner {
  readonly #decoder: MediaDecoder;
  readonly #client: MultimodalClient;

  constructor(decoder: MediaDecoder, client: MultimodalClient) {
    this.#decoder = decoder;
    this.#client = client;
  }

  async reason(input: ReasonVideoInput): Promise<ReasonVideoResult> {
    const frameCount = input.frameCount ?? 8;
    const frames = await this.#decoder.extractFrames({ videoBytes: input.videoBytes, count: frameCount });
    const segments = input.includeAudio
      ? await this.#decoder.extractAudio({ videoBytes: input.videoBytes })
      : [];
    const frameDescriptions = await Promise.all(
      frames.map((f) => this.#client.describeFrame({ frame: f, prompt: input.prompt })),
    );
    const transcripts = await Promise.all(
      segments.map((s) => this.#client.transcribe({ segment: s, ...(input.language ? { language: input.language } : {}) })),
    );
    const evidence: StepEvidence[] = [];
    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]!;
      evidence.push({
        atMs: frame.atMs,
        frameDescription: frameDescriptions[i],
        ...(frame.captionHint ? { captionHint: frame.captionHint } : {}),
      });
    }
    for (let i = 0; i < segments.length; i++) {
      evidence.push({ atMs: segments[i]!.startMs, transcript: transcripts[i] });
    }
    evidence.sort((a, b) => a.atMs - b.atMs);
    const summary = await this.#client.summarize({ steps: evidence, prompt: input.prompt });
    return { summary, evidence };
  }
}

/** Test helpers (re-exported for convenience). */
export type { AudioSegment, VideoFrame };
