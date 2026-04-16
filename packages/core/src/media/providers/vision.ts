/**
 * Vision providers — Claude and GPT-4o variants.
 *
 * Both wrap the chat/completions style endpoints with `image_url` or
 * `image.source` content blocks. We keep the surface narrow: take a list
 * of images + a question + optional structured-output schema; return a
 * plain-language description and (if requested) a structured object.
 */

import { fetchWithRetry } from '../../integrations/http.js';
import {
  Hipp0MediaError,
  type VisionDescribeInput,
  type VisionDescribeResult,
  type VisionImage,
  type VisionProvider,
} from '../types.js';

// ─── Claude ────────────────────────────────────────────────────────────────

const CLAUDE_DEFAULT_URL = 'https://api.anthropic.com/v1/messages';
const CLAUDE_DEFAULT_MODEL = 'claude-sonnet-4-20250514';

export interface ClaudeVisionOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  anthropicVersion?: string;
  fetch?: typeof fetch;
}

export class ClaudeVisionProvider implements VisionProvider {
  readonly name = 'claude-vision';

  constructor(private readonly opts: ClaudeVisionOptions) {}

  async describe(input: VisionDescribeInput): Promise<VisionDescribeResult> {
    const content = [
      ...input.images.map((img) => toClaudeImageBlock(img)),
      {
        type: 'text',
        text: buildPrompt(input),
      },
    ];
    const body = {
      model: input.model ?? this.opts.model ?? CLAUDE_DEFAULT_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content }],
    };
    const url = this.opts.baseUrl ?? CLAUDE_DEFAULT_URL;
    const doFetch = this.opts.fetch ?? fetch;
    const resp = await fetchWithRetry(() =>
      doFetch(url, {
        method: 'POST',
        headers: {
          'x-api-key': this.opts.apiKey,
          'anthropic-version': this.opts.anthropicVersion ?? '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
    );
    if (!resp.ok) {
      const txt = await resp.text().catch(() => '');
      throw new Hipp0MediaError(
        'HIPP0_VISION_CLAUDE_ERROR',
        `Claude vision ${resp.status}: ${txt.slice(0, 200)}`,
      );
    }
    const json = (await resp.json()) as { content?: Array<{ type: string; text?: string }> };
    const text = (json.content ?? []).find((b) => b.type === 'text')?.text ?? '';
    return buildResult('claude-vision', text, input.schema !== undefined);
  }
}

// ─── OpenAI (GPT-4o) ──────────────────────────────────────────────────────

const OPENAI_DEFAULT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_DEFAULT_MODEL = 'gpt-4o';

export interface OpenAIVisionOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class OpenAIVisionProvider implements VisionProvider {
  readonly name = 'openai-vision';

  constructor(private readonly opts: OpenAIVisionOptions) {}

  async describe(input: VisionDescribeInput): Promise<VisionDescribeResult> {
    const content: Array<Record<string, unknown>> = [
      { type: 'text', text: buildPrompt(input) },
      ...input.images.map((img) => ({
        type: 'image_url',
        image_url: { url: toDataUrl(img) },
      })),
    ];
    const body = {
      model: input.model ?? this.opts.model ?? OPENAI_DEFAULT_MODEL,
      messages: [{ role: 'user', content }],
      ...(input.schema && {
        response_format: { type: 'json_object' as const },
      }),
    };
    const url = this.opts.baseUrl ?? OPENAI_DEFAULT_URL;
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
      const txt = await resp.text().catch(() => '');
      throw new Hipp0MediaError(
        'HIPP0_VISION_OPENAI_ERROR',
        `OpenAI vision ${resp.status}: ${txt.slice(0, 200)}`,
      );
    }
    const json = (await resp.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content ?? '';
    return buildResult('openai-vision', text, input.schema !== undefined);
  }
}

// ─── Shared helpers ───────────────────────────────────────────────────────

function buildPrompt(input: VisionDescribeInput): string {
  const base =
    input.question ??
    'Describe what you see in the image(s). Note visible text, people, objects, and context.';
  if (!input.schema) return base;
  return `${base}\n\nReturn ONLY a valid JSON object conforming to this schema:\n${JSON.stringify(input.schema)}`;
}

function buildResult(provider: string, text: string, hadSchema: boolean): VisionDescribeResult {
  const r: VisionDescribeResult = { provider, description: text };
  if (hadSchema && text.trim()) {
    try {
      const parsed = JSON.parse(stripFence(text));
      if (parsed && typeof parsed === 'object') {
        r.structured = parsed as Record<string, unknown>;
      }
    } catch {
      // Not valid JSON — leave structured undefined; description still carries the text.
    }
  }
  return r;
}

function stripFence(text: string): string {
  return text.replace(/^```(?:json)?\n/, '').replace(/\n```$/, '').trim();
}

function toClaudeImageBlock(img: VisionImage): Record<string, unknown> {
  if (img.kind === 'url') {
    return { type: 'image', source: { type: 'url', url: img.url } };
  }
  const data = img.kind === 'buffer' ? bufferToBase64(img.data) : img.data;
  return {
    type: 'image',
    source: { type: 'base64', media_type: img.mimeType, data },
  };
}

function toDataUrl(img: VisionImage): string {
  if (img.kind === 'url') return img.url;
  const data = img.kind === 'buffer' ? bufferToBase64(img.data) : img.data;
  return `data:${img.mimeType};base64,${data}`;
}

function bufferToBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

/**
 * Deterministic offline vision stub — produces a description based on
 * image byte length. Useful for unit tests that need a VisionProvider
 * without network access.
 */
export class LocalVisionStub implements VisionProvider {
  readonly name = 'local-stub';

  async describe(input: VisionDescribeInput): Promise<VisionDescribeResult> {
    const sizes = input.images.map((img) => {
      if (img.kind === 'url') return img.url.length;
      if (img.kind === 'buffer') return img.data.length;
      return img.data.length;
    });
    const description = `Local stub described ${input.images.length} image(s) (byte sizes: ${sizes.join(', ')})`;
    const result: VisionDescribeResult = { provider: this.name, description };
    if (input.schema) result.structured = { images: input.images.length };
    return result;
  }
}
