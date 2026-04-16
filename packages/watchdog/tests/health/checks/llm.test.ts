import { describe, expect, it } from 'vitest';
import { LlmCheck, type LlmProviderProbe } from '../../../src/index.js';

const yes = () => true;
const no = () => false;

describe('LlmCheck', () => {
  it('fails when no providers are configured', async () => {
    const result = await new LlmCheck({ providers: [] }).run();
    expect(result.status).toBe('fail');
    expect(result.message).toMatch(/No LLM providers/);
  });

  it('returns ok when the only provider has a key and no ping is supplied', async () => {
    const result = await new LlmCheck({
      providers: [{ name: 'anthropic', hasApiKey: yes }],
    }).run();
    expect(result.status).toBe('ok');
  });

  it('returns ok when a ping resolves successfully', async () => {
    const result = await new LlmCheck({
      providers: [{ name: 'anthropic', hasApiKey: yes, ping: async () => {} }],
    }).run();
    expect(result.status).toBe('ok');
  });

  it('fails the only provider when its key is missing', async () => {
    const result = await new LlmCheck({
      providers: [{ name: 'anthropic', hasApiKey: no }],
    }).run();
    expect(result.status).toBe('fail');
    const providers = result.details?.['providers'] as Array<{ name: string; reason: string }>;
    expect(providers[0]!.reason).toBe('missing_api_key');
  });

  it('warns when secondary fails but primary stays healthy', async () => {
    const providers: LlmProviderProbe[] = [
      { name: 'anthropic', hasApiKey: yes },
      { name: 'openai', hasApiKey: no },
    ];
    const result = await new LlmCheck({ providers, primary: 'anthropic' }).run();
    expect(result.status).toBe('warn');
    expect(result.message).toMatch(/1\/2/);
  });

  it('fails when primary fails even if secondary is healthy', async () => {
    const providers: LlmProviderProbe[] = [
      { name: 'anthropic', hasApiKey: no },
      { name: 'openai', hasApiKey: yes },
    ];
    const result = await new LlmCheck({ providers, primary: 'anthropic' }).run();
    expect(result.status).toBe('fail');
    expect(result.details?.['primaryFailed']).toBe(true);
  });

  it('fails when ALL providers are unhealthy regardless of primary setting', async () => {
    const result = await new LlmCheck({
      providers: [
        { name: 'anthropic', hasApiKey: no },
        { name: 'openai', hasApiKey: no },
      ],
    }).run();
    expect(result.status).toBe('fail');
  });

  it('captures ping errors with their messages', async () => {
    const result = await new LlmCheck({
      providers: [
        {
          name: 'anthropic',
          hasApiKey: yes,
          ping: async () => {
            throw new Error('429 rate limit');
          },
        },
      ],
    }).run();
    expect(result.status).toBe('fail');
    const providers = result.details?.['providers'] as Array<{ name: string; reason: string }>;
    expect(providers[0]!.reason).toMatch(/429 rate limit/);
  });

  it('honors a custom name', () => {
    expect(new LlmCheck({ providers: [], name: 'llm-pool' }).name).toBe('llm-pool');
  });
});
