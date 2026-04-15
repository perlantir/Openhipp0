import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LLMClient } from '../../src/llm/client.js';
import type {
  LLMOptions,
  LLMProvider,
  LLMResponse,
  Message,
  StreamChunk,
} from '../../src/llm/types.js';
import {
  AgentRuntime,
  buildSystemPrompt,
  parseDecisionDirectives,
  type AgentRuntimeConfig,
  type MemoryAdapter,
} from '../../src/agent/index.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import type { ExecutionContext, Tool } from '../../src/tools/types.js';

// ─────────────────────────────────────────────────────────────────────────────
// Fakes
// ─────────────────────────────────────────────────────────────────────────────

/** Queue-driven fake provider: each call to chatSync returns the next scripted response. */
function scriptedProvider(responses: LLMResponse[]): LLMProvider {
  const queue = [...responses];
  return {
    name: 'scripted',
    model: 'test-model',
    async chatSync(): Promise<LLMResponse> {
      const next = queue.shift();
      if (!next) {
        throw new Error('scriptedProvider: exhausted responses');
      }
      return next;
    },
    async *chat(): AsyncGenerator<StreamChunk, LLMResponse> {
      const resp = await this.chatSync([] as Message[], {} as LLMOptions);
      yield { type: 'message_stop', stopReason: resp.stopReason, usage: resp.usage };
      return resp;
    },
    countTokens: (t: string) => Math.ceil(t.length / 4),
  };
}

function makeClient(responses: LLMResponse[]): LLMClient {
  const provider = scriptedProvider(responses);
  return new LLMClient(
    {
      providers: [{ type: 'anthropic', model: 'test-model' }],
      retry: { maxAttempts: 1, baseDelayMs: 1 },
    },
    {},
    () => provider,
  );
}

function resp(opts: {
  text?: string;
  toolUse?: { id: string; name: string; input: Record<string, unknown> };
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens';
}): LLMResponse {
  const content = [];
  if (opts.text) content.push({ type: 'text' as const, text: opts.text });
  if (opts.toolUse) {
    content.push({
      type: 'tool_use' as const,
      id: opts.toolUse.id,
      name: opts.toolUse.name,
      input: opts.toolUse.input,
    });
  }
  return {
    content,
    stopReason: opts.stopReason ?? (opts.toolUse ? 'tool_use' : 'end_turn'),
    usage: { inputTokens: 10, outputTokens: 5 },
    model: 'test-model',
    provider: 'scripted',
  };
}

function echoTool(): Tool<{ msg: string }> {
  return {
    name: 'echo',
    description: 'Echo the input message',
    inputSchema: { type: 'object', required: ['msg'], properties: { msg: { type: 'string' } } },
    validator: z.object({ msg: z.string() }),
    permissions: [],
    async execute(params) {
      return { ok: true, output: `echoed: ${params.msg}` };
    },
  };
}

function failingTool(): Tool<object> {
  return {
    name: 'failing',
    description: 'Always fails',
    inputSchema: { type: 'object' },
    validator: z.object({}),
    permissions: [],
    async execute() {
      return { ok: false, output: 'boom', errorCode: 'HIPP0_TEST_FAIL' };
    },
  };
}

function baseConfig(partial: Partial<AgentRuntimeConfig>): AgentRuntimeConfig {
  const registry = partial.toolRegistry ?? new ToolRegistry();
  const llmClient = partial.llmClient!;
  const exec: Omit<ExecutionContext, 'agent' | 'projectId'> = {
    sandbox: 'native',
    timeoutMs: 5_000,
    allowedPaths: [],
    allowedDomains: [],
    grantedPermissions: [],
  };
  return {
    llmClient,
    toolRegistry: registry,
    agent: { id: 'a1', name: 'Lead', role: 'lead' },
    projectId: 'proj-1',
    executionContext: exec,
    maxIterations: 20,
    ...partial,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('buildSystemPrompt', () => {
  it('includes header, base sections, compiled sections, and the decision footer', () => {
    const out = buildSystemPrompt(
      [{ title: 'Mission', body: 'Help the user.' }],
      { sections: [{ title: 'Recalled', body: 'Prior decision X.' }] },
      { id: 'a1', name: 'Lead', role: 'lead' },
    );
    expect(out).toContain('You are Lead, acting in the lead role.');
    expect(out).toContain('## Mission');
    expect(out).toContain('Help the user.');
    expect(out).toContain('## Recalled');
    expect(out).toContain('## Decision Protocol');
    expect(out).toContain('HIPP0_DECISION:');
  });
});

describe('parseDecisionDirectives', () => {
  it('extracts PROCEED with no argument', () => {
    expect(parseDecisionDirectives('HIPP0_DECISION: PROCEED')).toEqual([{ code: 'PROCEED' }]);
  });
  it('extracts OVERRIDE_TO with argument', () => {
    expect(parseDecisionDirectives('HIPP0_DECISION: OVERRIDE_TO qa-agent')).toEqual([
      { code: 'OVERRIDE_TO', argument: 'qa-agent' },
    ]);
  });
  it('ignores lines that are not directives', () => {
    const text = 'Here is my reasoning.\nHIPP0_DECISION: AWAIT_APPROVAL needs user sign-off';
    expect(parseDecisionDirectives(text)).toEqual([
      { code: 'AWAIT_APPROVAL', argument: 'needs user sign-off' },
    ]);
  });
  it('returns empty on no directive', () => {
    expect(parseDecisionDirectives('just a plain message')).toEqual([]);
  });
});

describe('AgentRuntime: simple message → response', () => {
  it('returns the assistant text when there are no tool calls', async () => {
    const client = makeClient([resp({ text: 'Hello, world.' })]);
    const runtime = new AgentRuntime(baseConfig({ llmClient: client }));

    const out = await runtime.handleMessage({ message: 'Hi' });
    expect(out.text).toBe('Hello, world.');
    expect(out.iterations).toBe(1);
    expect(out.toolCallsCount).toBe(0);
    expect(out.stoppedReason).toBe('end_turn');
    expect(out.tokensUsed).toEqual({ input: 10, output: 5 });
  });
});

describe('AgentRuntime: tool call flow', () => {
  it('executes tool, appends result, returns final text', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());
    const client = makeClient([
      resp({ toolUse: { id: 'tu_1', name: 'echo', input: { msg: 'hi' } } }),
      resp({ text: 'Tool returned: echoed: hi' }),
    ]);
    const onToolCall = vi.fn();
    const runtime = new AgentRuntime(
      baseConfig({
        llmClient: client,
        toolRegistry: registry,
        hooks: { onToolCall },
      }),
    );

    const out = await runtime.handleMessage({ message: 'Please echo "hi"' });

    expect(out.iterations).toBe(2);
    expect(out.toolCallsCount).toBe(1);
    expect(out.text).toBe('Tool returned: echoed: hi');
    expect(out.stoppedReason).toBe('end_turn');
    expect(onToolCall).toHaveBeenCalledOnce();
    expect(onToolCall.mock.calls[0]![0].ok).toBe(true);

    // Messages: user, assistant(tool_use), tool(tool_result), assistant(text)
    expect(out.messages).toHaveLength(4);
    expect(out.messages[0]!.role).toBe('user');
    expect(out.messages[1]!.role).toBe('assistant');
    expect(out.messages[2]!.role).toBe('tool');
    expect(out.messages[3]!.role).toBe('assistant');
  });

  it('propagates tool failures into tool_result blocks with isError', async () => {
    const registry = new ToolRegistry();
    registry.register(failingTool());
    const client = makeClient([
      resp({ toolUse: { id: 'tu_1', name: 'failing', input: {} } }),
      resp({ text: 'I got an error but handled it.' }),
    ]);
    const runtime = new AgentRuntime(baseConfig({ llmClient: client, toolRegistry: registry }));

    const out = await runtime.handleMessage({ message: 'Try the failing tool' });
    expect(out.iterations).toBe(2);
    expect(out.stoppedReason).toBe('end_turn');

    const toolMsg = out.messages[2]!;
    expect(toolMsg.role).toBe('tool');
    if (Array.isArray(toolMsg.content)) {
      const block = toolMsg.content[0];
      if (block && block.type === 'tool_result') {
        expect(block.isError).toBe(true);
        expect(block.content).toBe('boom');
      } else {
        throw new Error('expected tool_result block');
      }
    }
  });
});

describe('AgentRuntime: stopping conditions', () => {
  it('stops at maxIterations', async () => {
    // 5 scripted responses, all tool_use — runtime should stop at maxIter=3
    const registry = new ToolRegistry();
    registry.register(echoTool());
    const client = makeClient([
      resp({ toolUse: { id: '1', name: 'echo', input: { msg: 'a' } } }),
      resp({ toolUse: { id: '2', name: 'echo', input: { msg: 'b' } } }),
      resp({ toolUse: { id: '3', name: 'echo', input: { msg: 'c' } } }),
    ]);
    const runtime = new AgentRuntime(
      baseConfig({ llmClient: client, toolRegistry: registry, maxIterations: 3 }),
    );

    const out = await runtime.handleMessage({ message: 'loop forever' });
    expect(out.iterations).toBe(3);
    expect(out.toolCallsCount).toBe(3);
    expect(out.stoppedReason).toBe('max_iterations');
  });

  it('stops on tool_error_cascade after 3 consecutive error iterations', async () => {
    const registry = new ToolRegistry();
    registry.register(failingTool());
    const client = makeClient([
      resp({ toolUse: { id: '1', name: 'failing', input: {} } }),
      resp({ toolUse: { id: '2', name: 'failing', input: {} } }),
      resp({ toolUse: { id: '3', name: 'failing', input: {} } }),
    ]);
    const runtime = new AgentRuntime(
      baseConfig({ llmClient: client, toolRegistry: registry, maxIterations: 10 }),
    );

    const out = await runtime.handleMessage({ message: 'try anyway' });
    expect(out.iterations).toBe(3);
    expect(out.stoppedReason).toBe('tool_error_cascade');
  });

  it('rejects maxIterations < 1', () => {
    const client = makeClient([]);
    expect(() => new AgentRuntime(baseConfig({ llmClient: client, maxIterations: 0 }))).toThrow(
      RangeError,
    );
  });
});

describe('AgentRuntime: memory + system prompt integration', () => {
  it('invokes memory.compileContext and memory.recordSession', async () => {
    const client = makeClient([resp({ text: 'done' })]);
    const compileContext = vi.fn<MemoryAdapter['compileContext']>(async () => ({
      sections: [{ title: 'Recalled Facts', body: 'The user prefers TypeScript.' }],
    }));
    const recordSession = vi.fn<MemoryAdapter['recordSession']>(async () => undefined);
    const memory: MemoryAdapter = { compileContext, recordSession };

    const runtime = new AgentRuntime(baseConfig({ llmClient: client, memory }));

    await runtime.handleMessage({ message: 'hi', userId: 'u42' });

    expect(compileContext).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'hi',
        userId: 'u42',
        projectId: 'proj-1',
      }),
    );
    expect(recordSession).toHaveBeenCalledOnce();
    const session = recordSession.mock.calls[0]![0];
    expect(session.iterations).toBe(1);
    expect(session.finalText).toBe('done');
    expect(session.stoppedReason).toBe('end_turn');
  });

  it('passes tool defs only for registered tools', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());
    const client = makeClient([resp({ text: 'ok' })]);
    // Spy on the provider by wrapping the client
    const spy = vi.spyOn(client, 'chatSync');
    const runtime = new AgentRuntime(baseConfig({ llmClient: client, toolRegistry: registry }));

    await runtime.handleMessage({ message: 'hi' });

    expect(spy).toHaveBeenCalledOnce();
    const options = spy.mock.calls[0]![1]!;
    expect(options.tools).toBeDefined();
    expect(options.tools!.map((t) => t.name)).toEqual(['echo']);
  });

  it('toolNames filter restricts exposed tools', async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool());
    registry.register({
      ...echoTool(),
      name: 'other_tool',
    });
    const client = makeClient([resp({ text: 'ok' })]);
    const spy = vi.spyOn(client, 'chatSync');
    const runtime = new AgentRuntime(
      baseConfig({ llmClient: client, toolRegistry: registry, toolNames: ['echo'] }),
    );

    await runtime.handleMessage({ message: 'hi' });
    expect(spy.mock.calls[0]![1]!.tools!.map((t) => t.name)).toEqual(['echo']);
  });
});
