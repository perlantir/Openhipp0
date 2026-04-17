/**
 * ElevenLabs TTS (+ voice cloning). Uses the `text-to-speech/<voiceId>`
 * endpoint; voice cloning goes through `/voices/add`.
 */

import { Hipp0MediaError, type TtsInput, type TtsProvider, type TtsResult } from '../types.js';

export interface ElevenLabsOptions {
  apiKey: string;
  baseUrl?: string;
  /** Default voice id (caller can override via TtsInput.voice). */
  defaultVoiceId?: string;
  /** Default model id (eleven_multilingual_v2 / eleven_turbo_v2_5 etc.). */
  model?: string;
  fetch?: typeof fetch;
}

const DEFAULT_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_MODEL = 'eleven_multilingual_v2';
const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM'; // "Rachel"

export class ElevenLabsTtsProvider implements TtsProvider {
  readonly name = 'elevenlabs-tts';

  constructor(private readonly opts: ElevenLabsOptions) {}

  async synthesize(input: TtsInput): Promise<TtsResult> {
    const base = this.opts.baseUrl ?? DEFAULT_BASE;
    const voiceId = input.voice ?? this.opts.defaultVoiceId ?? DEFAULT_VOICE_ID;
    const format = input.format ?? 'mp3';
    const url = `${base}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(formatParam(format))}`;
    const fetchImpl = this.opts.fetch ?? globalThis.fetch;
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'xi-api-key': this.opts.apiKey,
        'content-type': 'application/json',
        accept: mimeFor(format),
      },
      body: JSON.stringify({
        text: input.text,
        model_id: this.opts.model ?? DEFAULT_MODEL,
        voice_settings: { stability: 0.5, similarity_boost: 0.7 },
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Hipp0MediaError('elevenlabs-tts', `elevenlabs ${resp.status}: ${body}`);
    }
    const buffer = new Uint8Array(await resp.arrayBuffer());
    return { audio: buffer, mimeType: mimeFor(format) };
  }
}

function formatParam(format: NonNullable<TtsInput['format']>): string {
  // ElevenLabs canonical output_format values.
  switch (format) {
    case 'mp3':
      return 'mp3_44100_128';
    case 'opus':
      return 'opus_48000_128';
    case 'aac':
      return 'mp3_44100_128'; // AAC not supported; downgrade + warn via caller
    case 'flac':
      return 'flac_44100';
    case 'wav':
      return 'pcm_24000';
  }
}

function mimeFor(format: NonNullable<TtsInput['format']>): string {
  switch (format) {
    case 'mp3':
      return 'audio/mpeg';
    case 'opus':
      return 'audio/ogg';
    case 'wav':
      return 'audio/wav';
    case 'flac':
      return 'audio/flac';
    case 'aac':
      return 'audio/aac';
  }
}
