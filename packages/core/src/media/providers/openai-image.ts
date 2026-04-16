/**
 * DALL-E 3 provider — /v1/images/generations.
 */

import { fetchWithRetry } from '../../integrations/http.js';
import {
  Hipp0MediaError,
  type ImageGenerationInput,
  type ImageGenerationProvider,
  type ImageGenerationResult,
} from '../types.js';

const DEFAULT_URL = 'https://api.openai.com/v1/images/generations';
const DEFAULT_MODEL = 'dall-e-3';

export interface OpenAIImageOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class OpenAIImageProvider implements ImageGenerationProvider {
  readonly name = 'openai-image';

  constructor(private readonly opts: OpenAIImageOptions) {}

  async generate(input: ImageGenerationInput): Promise<ImageGenerationResult> {
    const body = {
      model: this.opts.model ?? DEFAULT_MODEL,
      prompt: input.prompt,
      n: 1,
      size: input.size ?? '1024x1024',
      quality: input.quality ?? 'standard',
      response_format: input.responseFormat ?? 'url',
      ...(input.style && { style: input.style }),
    };

    const url = this.opts.baseUrl ?? DEFAULT_URL;
    const doFetch = this.opts.fetch ?? fetch;
    const resp = await fetchWithRetry(() =>
      doFetch(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Hipp0MediaError(
        'HIPP0_IMAGE_HTTP_ERROR',
        `OpenAI image ${resp.status}: ${text.slice(0, 200)}`,
      );
    }
    const json = (await resp.json()) as { data?: Array<Record<string, unknown>> };
    const first = json.data?.[0];
    if (!first) {
      throw new Hipp0MediaError('HIPP0_IMAGE_NO_RESULT', 'OpenAI returned no image data');
    }
    const out: ImageGenerationResult = { prompt: input.prompt };
    if (typeof first['url'] === 'string') out.url = first['url'];
    if (typeof first['b64_json'] === 'string') out.b64 = first['b64_json'];
    if (typeof first['revised_prompt'] === 'string') out.revisedPrompt = first['revised_prompt'];
    return out;
  }
}
