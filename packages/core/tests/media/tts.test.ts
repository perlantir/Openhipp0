import { describe, it, expect, vi } from 'vitest';
import { OpenAITtsProvider, LocalTtsStub } from '../../src/media/providers/openai-tts.js';
import { Hipp0MediaError } from '../../src/media/types.js';

describe('OpenAITtsProvider', () => {
  it('POSTs model + voice + text and returns audio bytes', async () => {
    const audio = new Uint8Array([0x49, 0x44, 0x33, 0x03]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(audio, { status: 200 }));
    const p = new OpenAITtsProvider({ apiKey: 'sk', fetch: fetchMock as unknown as typeof fetch });
    const r = await p.synthesize({ text: 'hello', voice: 'nova', format: 'mp3', speed: 1.25 });
    expect(r.mimeType).toBe('audio/mpeg');
    expect(r.audio.length).toBe(4);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/v1/audio/speech');
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body.voice).toBe('nova');
    expect(body.speed).toBe(1.25);
    expect(body.response_format).toBe('mp3');
    expect(body.input).toBe('hello');
  });

  it('throws Hipp0MediaError on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('no', { status: 500 }));
    const p = new OpenAITtsProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(p.synthesize({ text: 'x' })).rejects.toBeInstanceOf(Hipp0MediaError);
  });
});

describe('LocalTtsStub', () => {
  it('produces deterministic length silence audio', async () => {
    const stub = new LocalTtsStub();
    const r = await stub.synthesize({ text: 'one two three' });
    expect(r.audio.length).toBeGreaterThanOrEqual(768);
    expect(r.mimeType).toBe('audio/wav');
  });
});
