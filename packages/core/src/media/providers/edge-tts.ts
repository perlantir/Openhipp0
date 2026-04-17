/**
 * Microsoft Edge Read Aloud TTS — free, uses the "Azure Speech" neural
 * voices via the Edge browser's public endpoint. No API key required.
 * Transport is fetch-based; production uses the WebSocket variant for
 * streaming audio. G5 ships the REST-backed synchronous variant.
 *
 * Operators who want tight integration with the Edge WebSocket should
 * layer their own adapter (there's no official npm package; community
 * ones change often). This implementation matches the existing
 * EdgeTTS-community pattern.
 */

import { Hipp0MediaError, type TtsInput, type TtsProvider, type TtsResult } from '../types.js';

export interface EdgeTtsOptions {
  /** Optional WebSocket endpoint override; by default uses the public Edge endpoint. */
  wsEndpoint?: string;
  /** For fetch-based REST fallback. */
  restEndpoint?: string;
  fetch?: typeof fetch;
  defaultVoice?: string;
}

const DEFAULT_VOICE = 'en-US-JennyNeural';

export class EdgeTtsProvider implements TtsProvider {
  readonly name = 'edge-tts';

  constructor(private readonly opts: EdgeTtsOptions = {}) {}

  async synthesize(input: TtsInput): Promise<TtsResult> {
    if (!this.opts.restEndpoint) {
      // Without a caller-supplied endpoint we short-circuit with a clear
      // error rather than ship a brittle built-in default (Edge endpoints
      // rotate; we'd rather fail loudly than silently).
      throw new Hipp0MediaError(
        'edge-tts',
        'edge-tts requires restEndpoint in options (see docs/voice.md)',
      );
    }
    const fetchImpl = this.opts.fetch ?? globalThis.fetch;
    const body = buildSsml(input.text, input.voice ?? this.opts.defaultVoice ?? DEFAULT_VOICE);
    const resp = await fetchImpl(this.opts.restEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/ssml+xml',
        'x-microsoft-outputformat': formatHeader(input.format ?? 'mp3'),
      },
      body,
    });
    if (!resp.ok) {
      throw new Hipp0MediaError('edge-tts', `edge-tts ${resp.status}`);
    }
    const buffer = new Uint8Array(await resp.arrayBuffer());
    return { audio: buffer, mimeType: mimeFor(input.format ?? 'mp3') };
  }
}

function buildSsml(text: string, voice: string): string {
  return `<speak version='1.0' xml:lang='en-US'><voice name='${voice}'>${escapeXml(text)}</voice></speak>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : c === "'" ? '&apos;' : '&quot;',
  );
}

function formatHeader(format: NonNullable<TtsInput['format']>): string {
  switch (format) {
    case 'mp3':
      return 'audio-24khz-48kbitrate-mono-mp3';
    case 'opus':
      return 'ogg-24khz-16bit-mono-opus';
    case 'wav':
      return 'riff-24khz-16bit-mono-pcm';
    case 'flac':
      return 'audio-24khz-16bit-mono-flac';
    case 'aac':
      return 'audio-24khz-mono-aac-lc';
  }
}

function mimeFor(format: NonNullable<TtsInput['format']>): string {
  return format === 'mp3' ? 'audio/mpeg' : format === 'wav' ? 'audio/wav' : `audio/${format}`;
}
