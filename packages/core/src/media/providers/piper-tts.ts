/**
 * Piper TTS — local, offline, neural. Runs via subprocess or a
 * structural `PiperRunner` the caller provides (Node child_process
 * isn't imported here to keep core platform-agnostic).
 */

import { Hipp0MediaError, type TtsInput, type TtsProvider, type TtsResult } from '../types.js';

export interface PiperRunner {
  /** Accepts text + voice model path; returns raw WAV bytes. */
  run(input: { text: string; voiceModelPath: string; speed?: number }): Promise<Uint8Array>;
}

export interface PiperTtsOptions {
  runner: PiperRunner;
  /** Default voice model `.onnx` path (e.g. ~/.hipp0/piper/en_US-amy-medium.onnx). */
  voiceModelPath: string;
}

export class PiperTtsProvider implements TtsProvider {
  readonly name = 'piper-tts';

  constructor(private readonly opts: PiperTtsOptions) {}

  async synthesize(input: TtsInput): Promise<TtsResult> {
    if (input.format && input.format !== 'wav') {
      throw new Hipp0MediaError('piper-tts', `piper only outputs wav (got format=${input.format})`);
    }
    const audio = await this.opts.runner.run({
      text: input.text,
      voiceModelPath: this.opts.voiceModelPath,
      ...(input.speed !== undefined ? { speed: input.speed } : {}),
    });
    return { audio, mimeType: 'audio/wav' };
  }
}
