/**
 * buildAgentMessageHandler — build a real AgentRuntime-backed handler
 * for `hipp0 serve`'s WebBridge onMessage path.
 *
 * Behavior:
 *   - If `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` is present, constructs a
 *     full pipeline: LLMClient (the key's provider) → AgentRuntime →
 *     Hipp0MemoryAdapter on the shared DB client. Returns a handler that
 *     maps IncomingMessage → OutgoingMessage via agent.handleMessage.
 *   - If no key is present, returns `undefined` so the caller can fall back
 *     to the echo responder. The handler is strictly opt-in; we never
 *     invent an LLM to call.
 *
 * Project + agent identity:
 *   - projectId: `HIPP0_AGENT_PROJECT_ID` env or 'default'.
 *     We auto-create the row if missing (safe: projects have no secrets).
 *   - agent: `{ id: HIPP0_AGENT_ID ?? 'hipp0-default', name: 'Hipp0', role: 'assistant' }`.
 *
 * Tool registry:
 *   - Default is empty. The runtime works fine without tools — it just
 *     produces a direct text reply. Callers who want tools inject their own
 *     runtime via `HIPP0_AGENT_MODULE` (the existing plug-in path).
 */

import * as memory from '@openhipp0/memory';
import {
  AgentRuntime,
  LLMClient,
  ToolRegistry,
  llm,
  type AgentIdentity,
  type LLMProvider,
  type Message,
} from '@openhipp0/core';
import type { IncomingMessage, OutgoingMessage } from '@openhipp0/bridge';

type ProviderConfig = llm.ProviderConfig;
type HipppoDb = memory.db.HipppoDb;

export interface BuildAgentHandlerOptions {
  /** Drizzle DB handle — same one serve.ts already constructed for /api/*. */
  db: HipppoDb;
  /** Override providers (tests). */
  providerFactory?: (cfg: ProviderConfig) => LLMProvider;
  /** Override project id. Defaults to HIPP0_AGENT_PROJECT_ID or 'default'. */
  projectId?: string;
  /** Override agent identity. */
  agent?: AgentIdentity;
  /** When set, forces the agent even if no API key is present (tests). */
  forceProviders?: readonly ProviderConfig[];
}

export type AgentMessageHandler = (msg: IncomingMessage) => Promise<OutgoingMessage | undefined>;

/**
 * Handle returned by `buildAgentMessageHandler`. Exposes the message handler
 * plus a `reloadProviders` closure so `POST /api/config/llm` can hot-swap the
 * LLM ladder without restarting the daemon (LLMClient.reloadConfig atomically
 * replaces the slots; in-flight calls finish on the old ladder).
 */
export interface AgentRuntimeHandle {
  handler: AgentMessageHandler;
  reloadProviders: (next: readonly ProviderConfig[]) => void;
  llmClient: LLMClient;
}

export async function buildAgentMessageHandler(
  opts: BuildAgentHandlerOptions,
): Promise<AgentRuntimeHandle | undefined> {
  const providers = opts.forceProviders ?? inferProvidersFromEnv();
  if (providers.length === 0) return undefined; // no LLM wired → caller falls back

  const projectId =
    opts.projectId ?? process.env['HIPP0_AGENT_PROJECT_ID'] ?? 'default';
  const agent: AgentIdentity = opts.agent ?? {
    id: process.env['HIPP0_AGENT_ID'] ?? 'hipp0-default',
    name: process.env['HIPP0_AGENT_NAME'] ?? 'Hipp0',
    role: process.env['HIPP0_AGENT_ROLE'] ?? 'assistant',
  };

  // Auto-upsert project so maybeNudge / recordSession don't FK-fail.
  try {
    await opts.db
      .insert(memory.db.projects)
      .values({ id: projectId, name: projectId })
      .onConflictDoNothing();
  } catch {
    /* best-effort — ignore if the caller pre-seeded */
  }

  const llm = new LLMClient(
    { providers: [...providers] },
    {},
    opts.providerFactory,
  );
  const reloadProviders = (next: readonly ProviderConfig[]): void => {
    llm.reloadConfig(next);
  };

  const adapter = new memory.adapter.Hipp0MemoryAdapter({ db: opts.db });
  const registry = new ToolRegistry();
  const runtime = new AgentRuntime({
    llmClient: llm,
    toolRegistry: registry,
    agent,
    projectId,
    memory: adapter,
    executionContext: {
      sandbox: 'native',
      timeoutMs: 30_000,
      allowedPaths: [],
      allowedDomains: [],
      grantedPermissions: [],
    },
  });

  // Per-channel conversation history so multi-turn chat works. Keyed on
  // IncomingMessage.channel.id — matches how Gateway stores sessions.
  const conversations = new Map<string, Message[]>();
  const MAX_TURNS_KEPT = 20;

  const handler: AgentMessageHandler = async (msg) => {
    const channelId = msg.channel.id;
    const history = conversations.get(channelId) ?? [];
    try {
      const resp = await runtime.handleMessage({
        message: msg.text,
        conversation: history,
        ...(msg.user.id && { userId: msg.user.id }),
      });

      // Append the turn pair (user + assistant) to the channel history.
      history.push({ role: 'user', content: msg.text });
      history.push({ role: 'assistant', content: resp.text });
      // Trim oldest pairs to bound memory use (keep last N turns).
      while (history.length > MAX_TURNS_KEPT) history.shift();
      conversations.set(channelId, history);

      // Best-effort session persistence — failure must NOT break reply.
      try {
        await adapter.recordSession({
          projectId,
          agent,
          ...(msg.user.id && { userId: msg.user.id }),
          messages: resp.messages,
          finalText: resp.text,
          toolCallsCount: resp.toolCallsCount,
          tokensUsed: resp.tokensUsed,
        } as never);
      } catch {
        /* adapter handles its own errors; this outer catch is defense-in-depth */
      }

      return { text: resp.text };
    } catch (err) {
      return {
        text: `⚠️ agent error: ${(err as Error).message}`,
      };
    }
  };

  return { handler, reloadProviders, llmClient: llm };
}

/**
 * Resolve the provider ladder from a snapshot of env + config.json's `llm`
 * section. Models from config override the env-var defaults. Used by
 * `POST /api/config/llm` after it writes the new key/provider/model, so the
 * reload reflects everything we just persisted.
 */
export function inferProvidersFromState(opts: {
  env: NodeJS.ProcessEnv;
  configLlm?: { provider?: 'anthropic' | 'openai' | 'ollama'; model?: string };
}): readonly ProviderConfig[] {
  const out: ProviderConfig[] = [];
  const preferred = opts.configLlm?.provider;
  const preferredModel = opts.configLlm?.model;
  const pushAnthropic = (): void => {
    if (!opts.env['ANTHROPIC_API_KEY']) return;
    out.push({
      type: 'anthropic',
      model:
        (preferred === 'anthropic' && preferredModel) ||
        opts.env['HIPP0_ANTHROPIC_MODEL'] ||
        'claude-sonnet-4-6',
    });
  };
  const pushOpenAI = (): void => {
    if (!opts.env['OPENAI_API_KEY']) return;
    out.push({
      type: 'openai',
      model:
        (preferred === 'openai' && preferredModel) ||
        opts.env['HIPP0_OPENAI_MODEL'] ||
        'gpt-4o-mini',
    });
  };
  const pushOllama = (): void => {
    if (preferred !== 'ollama') return;
    out.push({
      type: 'ollama',
      model: preferredModel ?? opts.env['HIPP0_OLLAMA_MODEL'] ?? 'llama3.1',
    });
  };
  if (preferred === 'ollama') {
    pushOllama();
    pushAnthropic();
    pushOpenAI();
  } else if (preferred === 'openai') {
    pushOpenAI();
    pushAnthropic();
  } else {
    pushAnthropic();
    pushOpenAI();
  }
  return out;
}

/**
 * Pick the first available LLM provider based on env vars. Order:
 *   ANTHROPIC_API_KEY (claude-sonnet-4-6) → OPENAI_API_KEY (gpt-4o-mini).
 * Ollama is deliberately NOT auto-enabled (probe + connectivity concerns);
 * callers who want it set HIPP0_AGENT_MODULE or construct AgentRuntime
 * externally.
 */
function inferProvidersFromEnv(): readonly ProviderConfig[] {
  const out: ProviderConfig[] = [];
  if (process.env['ANTHROPIC_API_KEY']) {
    out.push({
      type: 'anthropic',
      model: process.env['HIPP0_ANTHROPIC_MODEL'] ?? 'claude-sonnet-4-6',
    });
  }
  if (process.env['OPENAI_API_KEY']) {
    out.push({
      type: 'openai',
      model: process.env['HIPP0_OPENAI_MODEL'] ?? 'gpt-4o-mini',
    });
  }
  return out;
}

