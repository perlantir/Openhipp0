/**
 * Multimodal reasoning contracts — video frame extraction, audio
 * transcription-plus-summary, HTML5 video caption parsing.
 *
 * All LLM calls are delegated to a caller-supplied `MultimodalClient`;
 * frame extraction + audio decoding are delegated to caller-supplied
 * `MediaDecoder` (ffmpeg wrapper, browser MediaSource, etc.).
 */

export interface VideoFrame {
  readonly atMs: number;
  readonly pngBytes: Uint8Array;
  /** Optional caption overlay extracted via OCR or track. */
  readonly captionHint?: string;
}

export interface AudioSegment {
  readonly startMs: number;
  readonly endMs: number;
  readonly pcmBytes: Uint8Array;
  readonly sampleRate: number;
  readonly channels: number;
}

export interface MediaDecoder {
  /** Extract N frames uniformly across the video's duration. */
  extractFrames(input: {
    readonly videoBytes: Uint8Array;
    readonly count: number;
  }): Promise<readonly VideoFrame[]>;
  /** Segment audio into ~15s chunks suitable for ASR. */
  extractAudio(input: {
    readonly videoBytes: Uint8Array;
    readonly chunkMs?: number;
  }): Promise<readonly AudioSegment[]>;
}

export interface MultimodalClient {
  /** Ask a vision model to describe a single frame. */
  describeFrame(input: { frame: VideoFrame; prompt: string }): Promise<string>;
  /** Transcribe an audio segment. */
  transcribe(input: { segment: AudioSegment; language?: string }): Promise<string>;
  /** Summarize an ordered sequence of transcripts + frame descriptions. */
  summarize(input: { steps: readonly StepEvidence[]; prompt: string }): Promise<string>;
}

export interface StepEvidence {
  readonly atMs: number;
  readonly transcript?: string;
  readonly frameDescription?: string;
  readonly captionHint?: string;
}

export interface Caption {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly language?: string;
}

export interface CaptionTrack {
  readonly language: string;
  readonly label: string;
  readonly captions: readonly Caption[];
}
