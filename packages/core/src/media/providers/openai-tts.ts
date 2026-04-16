/**
 * OpenAI TTS provider — /v1/audio/speech. Returns raw audio bytes.
 */

import { fetchWithRetry } from '../../integrations/http.js';
import { Hipp0MediaError, type TtsInput, type TtsProvider, type TtsResult } from '../types.js';

const DEFAULT_URL = 'https://api.openai.com/v1/audio/speech';
const DEFAULT_MODEL = 'tts-1';
const DEFAULT_VOICE = 'alloy';

const MIME: Record<NonNullable<TtsInput['format']>, string> = {
  mp3: 'audio/mpeg',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
  wav: 'audio/wav',
};

export interface OpenAITtsOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class OpenAITtsProvider implements TtsProvider {
  readonly name = 'openai-tts';

  constructor(private readonly opts: OpenAITtsOptions) {}

  async synthesize(input: TtsInput): Promise<TtsResult> {
    const format = input.format ?? 'mp3';
    const body = {
      model: this.opts.model ?? DEFAULT_MODEL,
      input: input.text,
      voice: input.voice ?? DEFAULT_VOICE,
      response_format: format,
      ...(input.speed !== undefined && { speed: input.speed }),
    };

    const url = this.opts.baseUrl ?? DEFAULT_URL;
    const doFetch = this.opts.fetch ?? fetch;
    const resp = await fetchWithRetry(() =>
      doFetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '');
      throw new Hipp0MediaError(
        'HIPP0_TTS_HTTP_ERROR',
        `OpenAI TTS ${resp.status}: ${bodyText.slice(0, 200)}`,
      );
    }
    const buf = new Uint8Array(await resp.arrayBuffer());
    return { audio: buf, mimeType: MIME[format] };
  }
}

/**
 * Deterministic local stub — returns silent audio of fixed length. Useful
 * for tests that need a TtsProvider without network access.
 */
export class LocalTtsStub implements TtsProvider {
  readonly name = 'local-stub';

  async synthesize(input: TtsInput): Promise<TtsResult> {
    // Synthesize 100ms of silence per word as a deterministic byte stream.
    const words = input.text.trim().split(/\s+/).filter(Boolean).length;
    const len = Math.max(256, words * 256);
    const audio = new Uint8Array(len);
    for (let i = 0; i < len; i++) audio[i] = 0;
    return { audio, mimeType: MIME[input.format ?? 'wav'] };
  }
}
