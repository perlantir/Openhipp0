import { describe, it, expect, vi } from 'vitest';
import { OpenAIWhisperProvider, WhisperCppProvider } from '../../src/media/providers/openai-whisper.js';
import { Hipp0MediaError } from '../../src/media/types.js';

describe('OpenAIWhisperProvider', () => {
  it('sends multipart form data and parses verbose_json response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ text: 'hello world', language: 'en', duration: 2.4 }),
        { status: 200 },
      ),
    );
    const p = new OpenAIWhisperProvider({ apiKey: 'sk-test', fetch: fetchMock as unknown as typeof fetch });
    const r = await p.transcribe({
      kind: 'buffer',
      data: new Uint8Array([1, 2, 3, 4]),
      filename: 'a.ogg',
      mimeType: 'audio/ogg',
    });
    expect(r.text).toBe('hello world');
    expect(r.language).toBe('en');
    expect(r.duration).toBe(2.4);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/v1/audio/transcriptions');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer sk-test');
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
  });

  it('forwards language + prompt hints when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ text: 'hi' }), { status: 200 }),
    );
    const p = new OpenAIWhisperProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await p.transcribe(
      { kind: 'buffer', data: new Uint8Array([9]), filename: 'x.mp3' },
      { language: 'fr', prompt: 'prior context' },
    );
    const form = fetchMock.mock.calls[0]![1]!.body as FormData;
    expect(form.get('language')).toBe('fr');
    expect(form.get('prompt')).toBe('prior context');
    expect(form.get('response_format')).toBe('verbose_json');
  });

  it('throws Hipp0MediaError on HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('auth failed', { status: 401 }));
    const p = new OpenAIWhisperProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(
      p.transcribe({ kind: 'buffer', data: new Uint8Array([1]), filename: 'a.ogg' }),
    ).rejects.toBeInstanceOf(Hipp0MediaError);
  });
});

describe('WhisperCppProvider', () => {
  it('shells out to the configured binary and returns trimmed stdout', async () => {
    const exec = vi.fn().mockResolvedValue({ stdout: '  hello there \n', stderr: '' });
    const p = new WhisperCppProvider({
      binaryPath: '/usr/local/bin/whisper',
      modelPath: '/models/base.en',
      exec,
    });
    const r = await p.transcribe({ kind: 'path', path: '/tmp/foo.wav' });
    expect(r.text).toBe('hello there');
    expect(exec).toHaveBeenCalledOnce();
    expect(exec.mock.calls[0]![0]).toContain('/usr/local/bin/whisper');
    expect(exec.mock.calls[0]![0]).toContain('/models/base.en');
    expect(exec.mock.calls[0]![0]).toContain('/tmp/foo.wav');
  });
});
