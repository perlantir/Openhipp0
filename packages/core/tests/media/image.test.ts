import { describe, it, expect, vi } from 'vitest';
import { OpenAIImageProvider } from '../../src/media/providers/openai-image.js';
import { Hipp0MediaError } from '../../src/media/types.js';

describe('OpenAIImageProvider', () => {
  it('returns url + revised_prompt when the provider returns them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ url: 'https://cdn/ai.png', revised_prompt: 'a dramatic sunset' }],
        }),
        { status: 200 },
      ),
    );
    const p = new OpenAIImageProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const r = await p.generate({ prompt: 'sunset', size: '1024x1024' });
    expect(r.url).toBe('https://cdn/ai.png');
    expect(r.revisedPrompt).toBe('a dramatic sunset');
    expect(r.prompt).toBe('sunset');

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    expect(body.size).toBe('1024x1024');
    expect(body.response_format).toBe('url');
  });

  it('returns b64 when response_format=b64_json', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ b64_json: 'YWJjZA==' }] }), { status: 200 }),
    );
    const p = new OpenAIImageProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const r = await p.generate({ prompt: 'cat', responseFormat: 'b64_json' });
    expect(r.b64).toBe('YWJjZA==');
    expect(r.url).toBeUndefined();
  });

  it('throws Hipp0MediaError when data array is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: [] }), { status: 200 }),
    );
    const p = new OpenAIImageProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(p.generate({ prompt: 'x' })).rejects.toBeInstanceOf(Hipp0MediaError);
  });

  it('throws Hipp0MediaError on HTTP error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('err', { status: 400 }));
    const p = new OpenAIImageProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    await expect(p.generate({ prompt: 'x' })).rejects.toBeInstanceOf(Hipp0MediaError);
  });
});
