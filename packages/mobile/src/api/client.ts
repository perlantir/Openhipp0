// packages/mobile/src/api/client.ts
// Thin fetch wrapper for the hipp0 REST API.
// Every request carries the paired device's bearer token + the server URL
// from the session store; the pairing module loads those from secure
// storage at boot.

export interface ApiClientConfig {
  baseUrl: string;
  bearer?: string;
  /** Override for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

export class ApiError extends Error {
  public readonly status: number;
  public readonly body?: unknown;
  constructor(status: number, message: string, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly bearer: string | undefined;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: ApiClientConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.bearer = cfg.bearer;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private headers(extra?: HeadersInit): HeadersInit {
    const base: Record<string, string> = { "Content-Type": "application/json" };
    if (this.bearer) base.Authorization = `Bearer ${this.bearer}`;
    return { ...base, ...(extra ?? {}) };
  }

  async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const response = await this.fetchImpl(url, {
      ...init,
      headers: this.headers(init?.headers),
    });
    if (!response.ok) {
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = await response.text().catch(() => undefined);
      }
      throw new ApiError(response.status, `${init?.method ?? "GET"} ${path} → ${response.status}`, body);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  // Health
  getHealth() {
    return this.request<{ status: "ok" | "warn" | "fail"; checks?: unknown[] }>("/api/health");
  }

  // Config
  getConfig() {
    return this.request<{ agents: unknown[]; cron: unknown[]; version: string }>("/api/config");
  }
  getAgents() {
    return this.request<readonly AgentSummary[]>("/api/config/agents");
  }
  getCron() {
    return this.request<readonly CronTaskSummary[]>("/api/config/cron");
  }

  // Skills
  getSkills() {
    return this.request<readonly SkillSummary[]>("/api/skills");
  }

  // Decisions
  listDecisions(query?: { limit?: number; agentId?: string }) {
    const params = new URLSearchParams();
    if (query?.limit) params.set("limit", String(query.limit));
    if (query?.agentId) params.set("agentId", query.agentId);
    const qs = params.size ? `?${params.toString()}` : "";
    return this.request<{ decisions: readonly DecisionSummary[] }>(`/api/decisions${qs}`);
  }
  getDecision(id: string) {
    return this.request<DecisionSummary>(`/api/decisions/${encodeURIComponent(id)}`);
  }

  // Memory
  getMemoryStats() {
    return this.request<MemoryStats>("/api/memory/stats");
  }
  searchMemory(q: string, limit = 20) {
    const qs = new URLSearchParams({ q, limit: String(limit) }).toString();
    return this.request<{ results: readonly MemorySearchHit[] }>(`/api/memory/search?${qs}`);
  }

  // Voice
  transcribeVoice(body: {
    audioBase64: string;
    mimeType?: string;
    filename?: string;
    language?: string;
  }) {
    return this.request<{ text: string; language?: string; duration?: number }>(
      "/api/voice/transcribe",
      { method: "POST", body: JSON.stringify(body) },
    );
  }
  synthesizeSpeech(body: {
    text: string;
    voice?: string;
    format?: "mp3" | "opus" | "aac" | "flac" | "wav";
  }) {
    return this.request<{ audioBase64: string; mimeType: string }>(
      "/api/voice/synthesize",
      { method: "POST", body: JSON.stringify(body) },
    );
  }

  // Push
  registerPushToken(body: { deviceId: string; pushToken: string; platform: "ios" | "android" }) {
    return this.request<{ ok: true }>("/api/push/register", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // LLM config (rotate provider / key / model from the Settings screen)
  updateLlmConfig(body: UpdateLlmRequest): Promise<UpdateLlmResponse> {
    return this.request<UpdateLlmResponse>("/api/config/llm", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  // Pairing (mobile-initiated)
  completePairing(body: {
    pairingToken: string;
    mobilePublicKey: string;
    deviceName?: string;
    platform?: "ios" | "android";
  }) {
    return this.request<{
      deviceId: string;
      serverPublicKey: string;
      envelope: { nonce: string; ciphertext: string };
    }>("/api/pairing/complete", {
      method: "POST",
      body: JSON.stringify(body),
    });
  }
}

// ── Types — kept here so the mobile package doesn't have to import the full
// core API surface. These mirror the fields the server actually emits.
export interface AgentSummary {
  id: string;
  name: string;
  description?: string;
  model?: string;
  skills?: readonly string[];
}
export interface CronTaskSummary {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  nextFireAt?: string;
}
export interface SkillSummary {
  name: string;
  version: string;
  description?: string;
  origin?: "builtin" | "user" | "marketplace";
}
export interface DecisionSummary {
  id: string;
  title: string;
  reasoning: string;
  tags: readonly string[];
  createdAt: string;
  outcome?: "positive" | "negative" | "neutral";
  agentId?: string;
}
export interface MemoryStats {
  decisions: number;
  skills: number;
  sessions: number;
  userFacts: number;
}
export interface MemorySearchHit {
  id: string;
  kind: "decision" | "skill" | "session";
  title: string;
  snippet: string;
  score: number;
}
export type LlmProvider = "anthropic" | "openai" | "ollama";
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
