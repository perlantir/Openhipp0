import { describe, it, expect, vi } from 'vitest';
import {
  ClaudeVisionProvider,
  OpenAIVisionProvider,
  LocalVisionStub,
} from '../../src/media/providers/vision.js';

describe('ClaudeVisionProvider', () => {
  it('POSTs image + question and parses content text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'A dog in a park.' }] }),
        { status: 200 },
      ),
    );
    const p = new ClaudeVisionProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const r = await p.describe({
      images: [{ kind: 'url', url: 'https://ex/pic.png' }],
      question: 'What do you see?',
    });
    expect(r.description).toBe('A dog in a park.');
    expect(r.provider).toBe('claude-vision');

    const init = fetchMock.mock.calls[0]![1]!;
    const headers = init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('k');
    expect(headers['anthropic-version']).toBeTruthy();
    const body = JSON.parse(String(init.body));
    expect(body.messages[0].content[0]).toMatchObject({
      type: 'image',
      source: { type: 'url', url: 'https://ex/pic.png' },
    });
  });

  it('extracts structured JSON when a schema is provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          content: [
            { type: 'text', text: '```json\n{"labels":["cat","red"],"confidence":0.92}\n```' },
          ],
        }),
        { status: 200 },
      ),
    );
    const p = new ClaudeVisionProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const r = await p.describe({
      images: [{ kind: 'buffer', data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }],
      schema: { type: 'object' },
    });
    expect(r.structured).toEqual({ labels: ['cat', 'red'], confidence: 0.92 });
  });
});

describe('OpenAIVisionProvider', () => {
  it('produces image_url content blocks and parses choices[0].message.content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ choices: [{ message: { content: 'Two people on a bench.' } }] }),
        { status: 200 },
      ),
    );
    const p = new OpenAIVisionProvider({ apiKey: 'k', fetch: fetchMock as unknown as typeof fetch });
    const r = await p.describe({
      images: [{ kind: 'base64', data: 'QUJD', mimeType: 'image/png' }],
    });
    expect(r.description).toBe('Two people on a bench.');

    const body = JSON.parse(String(fetchMock.mock.calls[0]![1]!.body));
    const imgBlock = body.messages[0].content.find(
      (c: Record<string, unknown>) => c['type'] === 'image_url',
    );
    expect(imgBlock.image_url.url).toBe('data:image/png;base64,QUJD');
  });
});

describe('LocalVisionStub', () => {
  it('produces a description based on image byte counts', async () => {
    const stub = new LocalVisionStub();
    const r = await stub.describe({
      images: [
        { kind: 'buffer', data: new Uint8Array(42), mimeType: 'image/png' },
        { kind: 'url', url: 'https://ex.com/a' },
      ],
    });
    expect(r.description).toContain('2 image');
    expect(r.description).toContain('42');
    expect(r.provider).toBe('local-stub');
  });
});
