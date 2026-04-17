import { describe, it, expect } from 'vitest';
import { updateLlmConfig } from '../../src/api/config.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('updateLlmConfig', () => {
  it('POSTs JSON body to /api/config/llm and returns the parsed response', async () => {
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push([url, init]);
      return jsonResponse(200, {
        ok: true,
        llm: { provider: 'openai', model: 'gpt-4o-mini' },
        apiKeyUpdated: true,
        hotSwapped: true,
      });
    }) as typeof fetch;
    const out = await updateLlmConfig(
      { provider: 'openai', apiKey: 'sk-new', model: 'gpt-4o-mini' },
      fetchImpl,
    );
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe('/api/config/llm');
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(init?.body as string)).toEqual({
      provider: 'openai',
      apiKey: 'sk-new',
      model: 'gpt-4o-mini',
    });
    expect(out.ok).toBe(true);
    expect(out.llm.provider).toBe('openai');
    expect(out.apiKeyUpdated).toBe(true);
  });

  it('throws with server error + detail when response is non-2xx', async () => {
    const fetchImpl = (async () =>
      jsonResponse(500, { error: 'reload failed', detail: 'deprecated model' })) as typeof fetch;
    await expect(updateLlmConfig({ provider: 'anthropic' }, fetchImpl)).rejects.toThrow(
      /reload failed.*deprecated model/,
    );
  });

  it('falls back to HTTP status when body is not JSON', async () => {
    const fetchImpl = (async () => new Response('boom', { status: 502 })) as typeof fetch;
    await expect(updateLlmConfig({ provider: 'anthropic' }, fetchImpl)).rejects.toThrow(/HTTP 502/);
  });
});
