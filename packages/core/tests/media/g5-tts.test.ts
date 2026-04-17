import { describe, expect, it, vi } from 'vitest';

import { EdgeTtsProvider } from '../../src/media/providers/edge-tts.js';
import { ElevenLabsTtsProvider } from '../../src/media/providers/elevenlabs-tts.js';
import { MiniMaxTtsProvider } from '../../src/media/providers/minimax-tts.js';
import { PiperTtsProvider } from '../../src/media/providers/piper-tts.js';
import { ElevenLabsVoiceCloner } from '../../src/media/voice-cloning.js';

function bytesResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(bytes, { status });
}

describe('EdgeTtsProvider', () => {
  it('fails when no restEndpoint is configured', async () => {
    const p = new EdgeTtsProvider();
    await expect(p.synthesize({ text: 'hi' })).rejects.toThrow(/restEndpoint/);
  });

  it('posts SSML to the configured endpoint', async () => {
    const fetchMock = vi.fn(async () => bytesResponse(new Uint8Array([1, 2, 3])));
    const p = new EdgeTtsProvider({ restEndpoint: 'https://x/tts', fetch: fetchMock as unknown as typeof fetch });
    const out = await p.synthesize({ text: 'hi', voice: 'en-US-JennyNeural' });
    expect(out.audio).toEqual(new Uint8Array([1, 2, 3]));
    const body = String(fetchMock.mock.calls[0]![1]!.body);
    expect(body).toContain('<speak');
    expect(body).toContain('en-US-JennyNeural');
  });
});

describe('ElevenLabsTtsProvider', () => {
  it('synthesizes audio with the configured voice + model', async () => {
    const fetchMock = vi.fn(async () => bytesResponse(new Uint8Array([4, 5, 6])));
    const p = new ElevenLabsTtsProvider({
      apiKey: 'xi-key',
      defaultVoiceId: 'voice-id',
      model: 'eleven_turbo_v2',
      fetch: fetchMock as unknown as typeof fetch,
    });
    const result = await p.synthesize({ text: 'hello' });
    expect(result.mimeType).toBe('audio/mpeg');
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('voice-id');
  });

  it('surfaces error body on non-2xx', async () => {
    const fetchMock = vi.fn(async () => new Response('rate limit', { status: 429 }));
    const p = new ElevenLabsTtsProvider({ apiKey: 'x', fetch: fetchMock as unknown as typeof fetch });
    await expect(p.synthesize({ text: 'hi' })).rejects.toThrow(/429/);
  });
});

describe('MiniMaxTtsProvider', () => {
  it('decodes hex audio from t2a_v2 response', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ data: { audio: 'abcd' }, base_resp: { status_code: 0 } }), { status: 200 }),
    );
    const p = new MiniMaxTtsProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const out = await p.synthesize({ text: 'hi' });
    expect(out.audio).toEqual(new Uint8Array([0xab, 0xcd]));
  });

  it('throws on non-zero base_resp status_code', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ base_resp: { status_code: 1002, status_msg: 'nope' } }), { status: 200 }),
    );
    const p = new MiniMaxTtsProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(p.synthesize({ text: 'hi' })).rejects.toThrow(/1002/);
  });
});

describe('PiperTtsProvider', () => {
  it('delegates to the injected runner and returns WAV bytes', async () => {
    const runner = { run: vi.fn().mockResolvedValue(new Uint8Array([7, 8, 9])) };
    const p = new PiperTtsProvider({ runner, voiceModelPath: '/v.onnx' });
    const out = await p.synthesize({ text: 'hi' });
    expect(out.mimeType).toBe('audio/wav');
    expect(out.audio).toEqual(new Uint8Array([7, 8, 9]));
  });

  it('rejects non-wav format requests', async () => {
    const runner = { run: vi.fn() };
    const p = new PiperTtsProvider({ runner, voiceModelPath: '/v.onnx' });
    await expect(p.synthesize({ text: 'hi', format: 'mp3' })).rejects.toThrow(/wav/);
  });
});

describe('ElevenLabsVoiceCloner', () => {
  it('requires watermark=true on the consent record', async () => {
    const cloner = new ElevenLabsVoiceCloner({ apiKey: 'x' });
    await expect(
      cloner.enroll({
        label: 'me',
        sampleBytes: [new Uint8Array([1, 2])],
        consent: { subjectId: 'u', grantedAt: '', watermark: false },
      }),
    ).rejects.toThrow(/watermark/);
  });

  it('posts FormData to /voices/add and returns voice_id', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ voice_id: 'v123' }), { status: 200 }),
    );
    const cloner = new ElevenLabsVoiceCloner({ apiKey: 'x', fetch: fetchMock as unknown as typeof fetch });
    const res = await cloner.enroll({
      label: 'me',
      sampleBytes: [new Uint8Array([1, 2])],
      consent: { subjectId: 'u', grantedAt: '', watermark: true },
    });
    expect(res.voiceId).toBe('v123');
  });
});
