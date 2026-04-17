import { describe, expect, it } from 'vitest';

import {
  createDeepSeekProvider,
  createFireworksProvider,
  createKimiProvider,
  createLMStudioProvider,
  createMiniMaxProvider,
  createMistralProvider,
  createOpenRouterProvider,
  createQwenProvider,
  createTogetherProvider,
  createVllmProvider,
  PROVIDER_CAPABILITY,
} from '../../../src/llm/providers/openai-compatible.js';

describe('openai-compatible factories', () => {
  it('each factory tags the provider + uses sensible default baseUrl', () => {
    const p1 = createOpenRouterProvider({ apiKey: 'x', model: 'm' });
    expect(p1.tag).toBe('openrouter');
    expect((p1 as unknown as { client: { baseURL?: string } }).client.baseURL).toContain('openrouter.ai');

    const p2 = createTogetherProvider({ apiKey: 'x', model: 'm' });
    expect(p2.tag).toBe('together');

    const p3 = createFireworksProvider({ apiKey: 'x', model: 'm' });
    expect(p3.tag).toBe('fireworks');

    const p4 = createDeepSeekProvider({ apiKey: 'x', model: 'm' });
    expect(p4.tag).toBe('deepseek');

    const p5 = createKimiProvider({ apiKey: 'x', model: 'm' });
    expect(p5.tag).toBe('kimi');

    const p6 = createMistralProvider({ apiKey: 'x', model: 'm' });
    expect(p6.tag).toBe('mistral');

    const p7 = createQwenProvider({ apiKey: 'x', model: 'm' });
    expect(p7.tag).toBe('qwen');

    const p8 = createMiniMaxProvider({ apiKey: 'x', model: 'm' });
    expect(p8.tag).toBe('minimax');

    const p9 = createLMStudioProvider({ apiKey: 'x', model: 'm' });
    expect(p9.tag).toBe('lmstudio');
  });

  it('vLLM requires a baseUrl', () => {
    expect(() => createVllmProvider({ apiKey: 'x', model: 'm' })).toThrow(/baseUrl/);
    const p = createVllmProvider({ apiKey: 'x', model: 'm', baseUrl: 'http://localhost:8000/v1' });
    expect(p.tag).toBe('vllm');
  });

  it('capability map covers every tag', () => {
    const tags: Array<keyof typeof PROVIDER_CAPABILITY> = [
      'openrouter', 'together', 'fireworks', 'deepseek', 'kimi', 'mistral',
      'vllm', 'lmstudio', 'azure-openai', 'qwen', 'glm', 'minimax', 'huggingface',
    ];
    for (const t of tags) {
      expect(PROVIDER_CAPABILITY[t].tag).toBe(t);
    }
  });
});
