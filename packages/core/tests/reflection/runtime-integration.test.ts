import { describe, expect, it, vi } from 'vitest';
import { LLMClient } from '../../src/llm/client.js';
import type {
  LLMOptions,
  LLMProvider,
  LLMResponse,
  Message,
  StreamChunk,
} from '../../src/llm/types.js';
import { AgentRuntime } from '../../src/agent/runtime.js';
import type { MemoryAdapter } from '../../src/agent/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { Critique, ReflectionEventInput } from '../../src/reflection/types.js';

function scriptedProvider(responses: LLMResponse[]): LLMProvider {
  const queue = [...responses];
  return {
    name: 'scripted',
    model: 'test-model',
    async chatSync(): Promise<LLMResponse> {
      const next = queue.shift();
      if (!next) throw new Error('scriptedProvider: exhausted responses');
      return next;
    },
    async *chat(): AsyncGenerator<StreamChunk, LLMResponse> {
      const r = await this.chatSync([] as Message[], {} as LLMOptions);
      yield { type: 'message_stop', stopReason: r.stopReason, usage: r.usage };
      return r;
    },
    countTokens: (t: string) => Math.ceil(t.length / 4),
  };
}

function client(responses: LLMResponse[]): LLMClient {
  return new LLMClient(
    {
      providers: [{ type: 'anthropic', model: 'test-model' }],
      retry: { maxAttempts: 1, baseDelayMs: 1 },
    },
    {},
    () => scriptedProvider(responses),
  );
}

function endTurn(text: string): LLMResponse {
  return {
    content: [{ type: 'text', text }],
    stopReason: 'end_turn',
    usage: { inputTokens: 1, outputTokens: 1 },
    model: 'test-model',
    provider: 'scripted',
  };
}

const noopMemory: MemoryAdapter = {
  async compileContext() {
    return { sections: [] };
  },
  async recordSession() {
    /* no-op */
  },
};

describe('AgentRuntime × reflection', () => {
  it('with reflection config absent, behavior matches baseline (no extra LLM call)', async () => {
    const runtime = new AgentRuntime({
      llmClient: client([endTurn('done')]),
      toolRegistry: new ToolRegistry(),
      agent: { id: 'a', name: 'a', role: 'r' },
      projectId: 'p',
      executionContext: {
        sandbox: 'native',
        timeoutMs: 1000,
        allowedPaths: [],
        allowedDomains: [],
        grantedPermissions: [],
      },
      memory: noopMemory,
    });
    const r = await runtime.handleMessage({ message: 'hi' });
    expect(r.text).toBe('done');
    expect(r.revisionsApplied).toBeUndefined();
  });

  it('rubric-pass draft with no tool calls skips LLM critique even when enabled', async () => {
    const critic = vi.fn();
    const runtime = new AgentRuntime({
      llmClient: client([endTurn('All good. Deployed to staging.')]),
      toolRegistry: new ToolRegistry(),
      agent: { id: 'a', name: 'a', role: 'r' },
      projectId: 'p',
      executionContext: {
        sandbox: 'native',
        timeoutMs: 1000,
        allowedPaths: [],
        allowedDomains: [],
        grantedPermissions: [],
      },
      memory: noopMemory,
      reflection: {
        adapter: { critiqueDraft: critic as never },
        config: { enabled: true },
      },
    });
    const r = await runtime.handleMessage({ message: 'hi' });
    expect(r.text).toBe('All good. Deployed to staging.');
    expect(critic).not.toHaveBeenCalled();
  });

  it('applies one revision when the critic confidently rejects', async () => {
    const runtime = new AgentRuntime({
      // First response: placeholder garbage. Second: the revised reply.
      llmClient: client([endTurn('TODO: fill in the actual answer'), endTurn('42.')]),
      toolRegistry: new ToolRegistry(),
      agent: { id: 'a', name: 'a', role: 'r' },
      projectId: 'p',
      executionContext: {
        sandbox: 'native',
        timeoutMs: 1000,
        allowedPaths: [],
        allowedDomains: [],
        grantedPermissions: [],
      },
      memory: noopMemory,
      reflection: {
        adapter: {
          critiqueDraft: async (): Promise<Critique> => ({
            accept: false,
            reason: 'contains placeholder',
            suggestions: ['provide the real answer, not TODO'],
            confidence: 0.9,
          }),
        },
        config: { enabled: true, maxRevisions: 1 },
      },
    });
    const r = await runtime.handleMessage({ message: 'what is the answer?' });
    expect(r.text).toBe('42.');
    expect(r.revisionsApplied).toBe(1);
  });

  it('does NOT revise past maxRevisions even if critic keeps rejecting', async () => {
    const runtime = new AgentRuntime({
      llmClient: client([endTurn('TODO'), endTurn('TODO'), endTurn('TODO')]),
      toolRegistry: new ToolRegistry(),
      agent: { id: 'a', name: 'a', role: 'r' },
      projectId: 'p',
      executionContext: {
        sandbox: 'native',
        timeoutMs: 1000,
        allowedPaths: [],
        allowedDomains: [],
        grantedPermissions: [],
      },
      memory: noopMemory,
      reflection: {
        adapter: {
          critiqueDraft: async (): Promise<Critique> => ({
            accept: false,
            reason: 'still TODO',
            confidence: 0.99,
          }),
        },
        config: { enabled: true, maxRevisions: 1 },
      },
    });
    const r = await runtime.handleMessage({ message: 'hi' });
    expect(r.revisionsApplied).toBe(1); // not 2+
  });

  it('persist hook receives both critique events when a revision is applied', async () => {
    const events: ReflectionEventInput[] = [];
    const runtime = new AgentRuntime({
      llmClient: client([endTurn('TODO'), endTurn('42.')]),
      toolRegistry: new ToolRegistry(),
      agent: { id: 'a', name: 'a', role: 'r' },
      projectId: 'p',
      executionContext: {
        sandbox: 'native',
        timeoutMs: 1000,
        allowedPaths: [],
        allowedDomains: [],
        grantedPermissions: [],
      },
      memory: noopMemory,
      reflection: {
        adapter: {
          critiqueDraft: async (): Promise<Critique> => ({
            accept: false,
            reason: 'placeholder',
            confidence: 0.95,
          }),
        },
        config: {
          enabled: true,
          maxRevisions: 1,
          persist: (e) => {
            events.push(e);
          },
        },
      },
    });
    await runtime.handleMessage({ message: 'hi' });
    // First turn: critic rejected → revisionApplied=true. Second turn: rubric
    // passed, no LLM critique, still persisted.
    expect(events).toHaveLength(2);
    expect(events[0]?.revisionApplied).toBe(true);
    expect(events[1]?.llmInvoked).toBe(false);
  });
});
