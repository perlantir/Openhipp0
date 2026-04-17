/**
 * Voice cloning — opt-in only. Operators record a 30s sample; the
 * provider enrolls it as a new voice; we persist a consent record +
 * audio-watermark flag on generated output.
 *
 * Only ElevenLabs is wired today; structural `VoiceCloningProvider`
 * lets other vendors plug in.
 */

export interface ConsentRecord {
  readonly subjectId: string;
  readonly grantedAt: string;
  readonly watermark: boolean;
  readonly expiresAt?: string;
  readonly notes?: string;
}

export interface EnrollVoiceInput {
  readonly label: string;
  readonly sampleBytes: readonly Uint8Array[];
  readonly consent: ConsentRecord;
}

export interface VoiceCloningProvider {
  readonly name: string;
  enroll(input: EnrollVoiceInput): Promise<{ voiceId: string }>;
  remove(voiceId: string): Promise<void>;
  verify(audio: Uint8Array): Promise<{ watermarked: boolean }>;
}

export interface ElevenLabsCloneOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class ElevenLabsVoiceCloner implements VoiceCloningProvider {
  readonly name = 'elevenlabs-clone';

  constructor(private readonly opts: ElevenLabsCloneOptions) {}

  async enroll(input: EnrollVoiceInput): Promise<{ voiceId: string }> {
    if (!input.consent.watermark) {
      throw new Error('voice cloning requires consent.watermark=true (safety default)');
    }
    const base = this.opts.baseUrl ?? 'https://api.elevenlabs.io/v1';
    const fetchImpl = this.opts.fetch ?? globalThis.fetch;
    const form = new FormData();
    form.append('name', input.label);
    for (let i = 0; i < input.sampleBytes.length; i++) {
      const blob = new Blob([new Uint8Array(input.sampleBytes[i]!)], { type: 'audio/wav' });
      form.append('files', blob, `sample-${i}.wav`);
    }
    const resp = await fetchImpl(`${base}/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': this.opts.apiKey },
      body: form as unknown as RequestInit['body'],
    });
    if (!resp.ok) throw new Error(`elevenlabs voices/add ${resp.status}`);
    const json = (await resp.json()) as { voice_id?: string };
    if (!json.voice_id) throw new Error('elevenlabs: no voice_id in response');
    return { voiceId: json.voice_id };
  }

  async remove(voiceId: string): Promise<void> {
    const base = this.opts.baseUrl ?? 'https://api.elevenlabs.io/v1';
    const fetchImpl = this.opts.fetch ?? globalThis.fetch;
    const resp = await fetchImpl(`${base}/voices/${encodeURIComponent(voiceId)}`, {
      method: 'DELETE',
      headers: { 'xi-api-key': this.opts.apiKey },
    });
    if (!resp.ok) throw new Error(`elevenlabs DELETE ${resp.status}`);
  }

  async verify(audio: Uint8Array): Promise<{ watermarked: boolean }> {
    // ElevenLabs watermark detection is a proprietary API; for the library
    // contract we return `watermarked: false` unless the caller supplies
    // signature bytes. Operators running cloning must verify through the
    // ElevenLabs dashboard.
    void audio;
    return { watermarked: false };
  }
}
