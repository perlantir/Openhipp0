/**
 * Client-side calls for `/api/config/*`. Defaults to same-origin fetch;
 * tests inject a fake `fetchImpl` to avoid the network.
 */

export type LlmProvider = 'anthropic' | 'openai' | 'ollama';

export interface UpdateLlmRequest {
  provider: LlmProvider;
  apiKey?: string;
  model?: string;
}

export interface UpdateLlmResponse {
  ok: boolean;
  llm: { provider: LlmProvider; model?: string };
  apiKeyUpdated: boolean;
  hotSwapped: boolean;
}

export async function updateLlmConfig(
  req: UpdateLlmRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<UpdateLlmResponse> {
  const resp = await fetchImpl('/api/config/llm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!resp.ok) {
    let detail = `HTTP ${resp.status}`;
    try {
      const body = (await resp.json()) as { error?: string; detail?: string };
      if (body?.error) detail = body.error;
      if (body?.detail) detail += ` — ${body.detail}`;
    } catch {
      /* non-JSON body; keep the status */
    }
    throw new Error(detail);
  }
  return (await resp.json()) as UpdateLlmResponse;
}
