/**
 * MiniMax speech-2.5-tts (+ bilingual) TTS provider.
 */

import { Hipp0MediaError, type TtsInput, type TtsProvider, type TtsResult } from '../types.js';

export interface MiniMaxTtsOptions {
  apiKey: string;
  groupId?: string;
  baseUrl?: string;
  model?: string; // "speech-2.5-hd" / "speech-02-hd"
  defaultVoice?: string;
  fetch?: typeof fetch;
}

const DEFAULT_BASE = 'https://api.minimaxi.chat/v1';
const DEFAULT_MODEL = 'speech-02-hd';
const DEFAULT_VOICE = 'male-qn-qingse';

export class MiniMaxTtsProvider implements TtsProvider {
  readonly name = 'minimax-tts';

  constructor(private readonly opts: MiniMaxTtsOptions) {}

  async synthesize(input: TtsInput): Promise<TtsResult> {
    const base = this.opts.baseUrl ?? DEFAULT_BASE;
    const url = this.opts.groupId
      ? `${base}/t2a_v2?GroupId=${encodeURIComponent(this.opts.groupId)}`
      : `${base}/t2a_v2`;
    const fetchImpl = this.opts.fetch ?? globalThis.fetch;
    const body = {
      model: this.opts.model ?? DEFAULT_MODEL,
      text: input.text,
      voice_setting: { voice_id: input.voice ?? this.opts.defaultVoice ?? DEFAULT_VOICE, speed: input.speed ?? 1, vol: 1, pitch: 0 },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: (input.format ?? 'mp3') },
      stream: false,
    };
    const resp = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Hipp0MediaError('minimax-tts', `minimax ${resp.status}: ${text}`);
    }
    const json = (await resp.json()) as { data?: { audio?: string }; base_resp?: { status_code: number; status_msg?: string } };
    if (json.base_resp && json.base_resp.status_code !== 0) {
      throw new Hipp0MediaError('minimax-tts', `minimax ${json.base_resp.status_code}: ${json.base_resp.status_msg}`);
    }
    if (!json.data?.audio) throw new Hipp0MediaError('minimax-tts', 'minimax: missing audio in response');
    // MiniMax returns hex-encoded audio.
    const buffer = hexToUint8(json.data.audio);
    const format = input.format ?? 'mp3';
    return { audio: buffer, mimeType: format === 'mp3' ? 'audio/mpeg' : `audio/${format}` };
  }
}

function hexToUint8(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
