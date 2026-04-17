// packages/mobile/tests/api-client.test.ts
// Covers the POST /api/config/llm surface + ApiError shape for non-2xx.

import { describe, it, expect } from "vitest";
import { ApiClient, ApiError } from "../src/api/client.js";
import { buildUpdateLlmRequest } from "../src/screens/LlmConfigSection.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ApiClient.updateLlmConfig", () => {
  it("POSTs JSON + bearer to /api/config/llm and parses the success body", async () => {
    const calls: Array<[string, RequestInit]> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push([url, init ?? {}]);
      return jsonResponse(200, {
        ok: true,
        llm: { provider: "openai", model: "gpt-4o-mini" },
        apiKeyUpdated: true,
        hotSwapped: true,
      });
    }) as unknown as typeof fetch;
    const client = new ApiClient({
      baseUrl: "https://hipp0.local",
      bearer: "tok-abc",
      fetchImpl,
    });

    const out = await client.updateLlmConfig({
      provider: "openai",
      apiKey: "sk-new-mobile",
      model: "gpt-4o-mini",
    });

    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe("https://hipp0.local/api/config/llm");
    expect(init.method).toBe("POST");
    const hdrs = init.headers as Record<string, string>;
    expect(hdrs["Content-Type"]).toBe("application/json");
    expect(hdrs["Authorization"]).toBe("Bearer tok-abc");
    expect(JSON.parse(init.body as string)).toEqual({
      provider: "openai",
      apiKey: "sk-new-mobile",
      model: "gpt-4o-mini",
    });
    expect(out.ok).toBe(true);
    expect(out.hotSwapped).toBe(true);
  });

  it("throws ApiError with status + body on non-2xx", async () => {
    const fetchImpl = (async () =>
      jsonResponse(400, { error: "invalid body", issues: [{ path: "provider" }] })) as typeof fetch;
    const client = new ApiClient({ baseUrl: "https://h", fetchImpl });
    let thrown: unknown;
    try {
      await client.updateLlmConfig({ provider: "anthropic" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ApiError);
    const e = thrown as ApiError;
    expect(e.status).toBe(400);
    expect((e.body as { error: string }).error).toBe("invalid body");
  });
});

describe("buildUpdateLlmRequest", () => {
  it("includes provider always", () => {
    expect(buildUpdateLlmRequest({ provider: "anthropic", apiKey: "", model: "" })).toEqual({
      provider: "anthropic",
    });
  });

  it("includes apiKey only when non-empty after trim", () => {
    expect(
      buildUpdateLlmRequest({ provider: "openai", apiKey: "  sk-x  ", model: "" }),
    ).toEqual({ provider: "openai", apiKey: "sk-x" });
    expect(
      buildUpdateLlmRequest({ provider: "openai", apiKey: "   ", model: "" }),
    ).toEqual({ provider: "openai" });
  });

  it("includes model only when non-empty after trim", () => {
    expect(
      buildUpdateLlmRequest({ provider: "anthropic", apiKey: "", model: " claude-sonnet-4-6 " }),
    ).toEqual({ provider: "anthropic", model: "claude-sonnet-4-6" });
  });

  it("carries all three when all are provided", () => {
    expect(
      buildUpdateLlmRequest({
        provider: "anthropic",
        apiKey: "sk-abc",
        model: "claude-sonnet-4-6",
      }),
    ).toEqual({ provider: "anthropic", apiKey: "sk-abc", model: "claude-sonnet-4-6" });
  });
});
