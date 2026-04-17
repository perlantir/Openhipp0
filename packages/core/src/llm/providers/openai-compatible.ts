/**
 * Factory helpers for OpenAI-compatible providers. Every one of these
 * services speaks the OpenAI Chat Completions shape; we wrap
 * `OpenAIProvider` with the right baseUrl + default model.
 *
 *   OpenRouter, Together AI, Fireworks, DeepSeek, Moonshot/Kimi
 *   (international), Mistral (La Plateforme), vLLM, LM Studio,
 *   Azure OpenAI (via `?api-version=` shim), Qwen (DashScope intl),
 *   Zhipu GLM (z.ai intl), MiniMax (intl).
 *
 * All options collapse to `{ apiKey, model, baseUrl? }` — documented
 * defaults are included for convenience.
 */

import { OpenAIProvider, type OpenAIProviderOptions } from '../provider-openai.js';

export interface CompatFactoryOptions {
  /** API key for the upstream service. */
  readonly apiKey?: string;
  /** Model id (provider-specific slug). */
  readonly model: string;
  /** Override baseUrl (usually only for self-hosted: vLLM / LM Studio). */
  readonly baseUrl?: string;
}

export type ProviderTag =
  | 'openrouter'
  | 'together'
  | 'fireworks'
  | 'deepseek'
  | 'kimi'
  | 'mistral'
  | 'vllm'
  | 'lmstudio'
  | 'azure-openai'
  | 'qwen'
  | 'glm'
  | 'minimax'
  | 'huggingface';

export interface TaggedProvider extends OpenAIProvider {
  readonly tag: ProviderTag;
}

function tagged(tag: ProviderTag, opts: OpenAIProviderOptions): TaggedProvider {
  const base = new OpenAIProvider(opts);
  Object.defineProperty(base, 'tag', { value: tag, enumerable: true, configurable: false });
  return base as TaggedProvider;
}

// ─── Factory functions ─────────────────────────────────────────────────────

export function createOpenRouterProvider(opts: CompatFactoryOptions): TaggedProvider {
  return tagged('openrouter', {
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? 'https://openrouter.ai/api/v1',
  });
}

export function createTogetherProvider(opts: CompatFactoryOptions): TaggedProvider {
  return tagged('together', {
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? 'https://api.together.xyz/v1',
  });
}

export function createFireworksProvider(opts: CompatFactoryOptions): TaggedProvider {
  return tagged('fireworks', {
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? 'https://api.fireworks.ai/inference/v1',
  });
}

export function createDeepSeekProvider(opts: CompatFactoryOptions): TaggedProvider {
  return tagged('deepseek', {
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? 'https://api.deepseek.com/v1',
  });
}

export function createKimiProvider(opts: CompatFactoryOptions): TaggedProvider {
  // Moonshot Kimi international endpoint.
  return tagged('kimi', {
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? 'https://api.moonshot.ai/v1',
  });
}

export function createMistralProvider(opts: CompatFactoryOptions): TaggedProvider {
  // La Plateforme OpenAI-compat endpoint.
  return tagged('mistral', {
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? 'https://api.mistral.ai/v1',
  });
}

export function createQwenProvider(opts: CompatFactoryOptions): TaggedProvider {
  // Alibaba DashScope international OpenAI-compatible endpoint.
  return tagged('qwen', {
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
  });
}

export function createGlmProvider(opts: CompatFactoryOptions): TaggedProvider {
  // z.ai / Zhipu international endpoint.
  return tagged('glm', {
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? 'https://open.bigmodel.cn/api/paas/v4',
  });
}

export function createMiniMaxProvider(opts: CompatFactoryOptions): TaggedProvider {
  // MiniMax international endpoint.
  return tagged('minimax', {
    model: opts.model,
    apiKey: opts.apiKey,
    baseUrl: opts.baseUrl ?? 'https://api.minimaxi.chat/v1',
  });
}

export function createVllmProvider(opts: CompatFactoryOptions): TaggedProvider {
  // Self-hosted; operator must supply baseUrl.
  if (!opts.baseUrl) throw new Error('vLLM requires baseUrl (e.g. http://localhost:8000/v1)');
  return tagged('vllm', {
    model: opts.model,
    apiKey: opts.apiKey ?? 'not-needed',
    baseUrl: opts.baseUrl,
  });
}

export function createLMStudioProvider(opts: CompatFactoryOptions): TaggedProvider {
  // LM Studio exposes an OpenAI-compat endpoint, default localhost:1234.
  return tagged('lmstudio', {
    model: opts.model,
    apiKey: opts.apiKey ?? 'not-needed',
    baseUrl: opts.baseUrl ?? 'http://localhost:1234/v1',
  });
}

export function createAzureOpenAIProvider(opts: CompatFactoryOptions & {
  readonly resourceName: string;
  readonly deployment: string;
  readonly apiVersion?: string;
}): TaggedProvider {
  // Azure's endpoint shape is /openai/deployments/<name>/chat/completions?api-version=...
  // The simplest way to pass through OpenAIProvider is to set baseUrl to the
  // deployment + leverage defaultQuery support via headers (OpenAI SDK lets
  // you set query via `defaultQuery`, but our wrapper doesn't expose it).
  // Operators that need Azure should use the `azure-openai` compat baseUrl
  // via an outer proxy; we document this in the provider README.
  const version = opts.apiVersion ?? '2024-08-01-preview';
  const baseUrl =
    opts.baseUrl ??
    `https://${opts.resourceName}.openai.azure.com/openai/deployments/${opts.deployment}?api-version=${version}`;
  return tagged('azure-openai', { model: opts.model, apiKey: opts.apiKey, baseUrl });
}

export function createHuggingFaceProvider(opts: CompatFactoryOptions & { readonly endpointId?: string }): TaggedProvider {
  // HF serverless OpenAI-compat + dedicated endpoint variant.
  const baseUrl =
    opts.baseUrl ??
    (opts.endpointId
      ? `https://${opts.endpointId}.endpoints.huggingface.cloud/v1`
      : 'https://api-inference.huggingface.co/v1');
  return tagged('huggingface', { model: opts.model, apiKey: opts.apiKey, baseUrl });
}

// ─── Capability metadata (coarse — full catalog lives in models.dev) ───────

export interface ProviderCapability {
  readonly tag: ProviderTag;
  readonly vision: boolean;
  readonly tools: boolean;
  readonly streaming: boolean;
  readonly notes?: string;
}

export const PROVIDER_CAPABILITY: Readonly<Record<ProviderTag, ProviderCapability>> = {
  openrouter: { tag: 'openrouter', vision: true, tools: true, streaming: true, notes: 'aggregator — per-model' },
  together: { tag: 'together', vision: true, tools: true, streaming: true },
  fireworks: { tag: 'fireworks', vision: true, tools: true, streaming: true },
  deepseek: { tag: 'deepseek', vision: false, tools: true, streaming: true },
  kimi: { tag: 'kimi', vision: true, tools: true, streaming: true, notes: 'up to 2M ctx on K2' },
  mistral: { tag: 'mistral', vision: true, tools: true, streaming: true },
  vllm: { tag: 'vllm', vision: false, tools: true, streaming: true, notes: 'capability depends on served model' },
  lmstudio: { tag: 'lmstudio', vision: false, tools: false, streaming: true, notes: 'tools unreliable on <8B' },
  'azure-openai': { tag: 'azure-openai', vision: true, tools: true, streaming: true },
  qwen: { tag: 'qwen', vision: true, tools: true, streaming: true, notes: 'Qwen3-VL vision-native' },
  glm: { tag: 'glm', vision: true, tools: true, streaming: true },
  minimax: { tag: 'minimax', vision: false, tools: true, streaming: true, notes: 'TTS available separately' },
  huggingface: { tag: 'huggingface', vision: false, tools: false, streaming: true, notes: 'depends on served model' },
};
