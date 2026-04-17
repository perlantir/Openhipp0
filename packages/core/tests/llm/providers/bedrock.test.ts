import { describe, expect, it, vi } from 'vitest';

import { BedrockProvider } from '../../../src/llm/providers/bedrock.js';

describe('BedrockProvider', () => {
  it('encodes the Anthropic body and parses the response', async () => {
    const invoke = vi.fn(async () => ({
      statusCode: 200,
      body: JSON.stringify({
        content: [{ type: 'text', text: 'hi' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 3, output_tokens: 1 },
      }),
    }));
    const p = new BedrockProvider({ model: 'anthropic.claude-3-5-sonnet-20241022-v2:0', invoke });
    const resp = await p.chatSync([{ role: 'user', content: 'hi' }], { system: 'be helpful' });
    expect(resp.content).toEqual([{ type: 'text', text: 'hi' }]);
    expect(resp.stopReason).toBe('end_turn');
    expect(invoke).toHaveBeenCalledOnce();
    const call = invoke.mock.calls[0]![0];
    expect(call.modelId).toContain('anthropic.claude-3-5-sonnet');
    const body = JSON.parse(call.body);
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
    expect(body.system).toBe('be helpful');
  });

  it('throws retryable on 503', async () => {
    const invoke = vi.fn(async () => ({ statusCode: 503, body: 'server error' }));
    const p = new BedrockProvider({ model: 'm', invoke });
    await expect(p.chatSync([{ role: 'user', content: 'x' }])).rejects.toMatchObject({ retryable: true });
  });
});
