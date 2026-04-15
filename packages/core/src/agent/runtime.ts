/**
 * AgentRuntime — the agentic loop.
 *
 * Per message:
 *   1. Compile memory context (via MemoryAdapter; NoopMemoryAdapter for 1g).
 *   2. Build the system prompt (header + base sections + compiled + decision footer).
 *   3. Loop (up to maxIterations):
 *      a. LLM.chatSync(messages, {tools, system}).
 *      b. Append assistant message.
 *      c. If no tool_use blocks → break (end_turn).
 *      d. Execute each tool via ToolRegistry (permission check + validation +
 *         timeout + audit). Append a role:"tool" message with tool_result
 *         blocks. If 3 iterations in a row have any tool error → stop with
 *         stoppedReason=tool_error_cascade.
 *   4. Record the session via MemoryAdapter.recordSession (no-op in 1g).
 *   5. Return AgentResponse.
 *
 * Not done in 1g (stubs only, land in Phase 2):
 *   - Decision extraction from the session
 *   - Skill auto-creation
 *   - User-model update
 *   - Memory nudge
 */

import type { ContentBlock, Message, ToolDef, ToolUseBlock } from '../llm/types.js';
import type { ExecutionContext } from '../tools/types.js';
import { buildSystemPrompt } from './prompt-builder.js';
import {
  NoopMemoryAdapter,
  type AgentResponse,
  type AgentRuntimeConfig,
  type HandleMessageRequest,
  type StoppedReason,
} from './types.js';

const DEFAULT_MAX_ITERATIONS = 20;
const TOOL_ERROR_CASCADE_THRESHOLD = 3;

export class AgentRuntime {
  constructor(private readonly config: AgentRuntimeConfig) {
    if ((config.maxIterations ?? DEFAULT_MAX_ITERATIONS) < 1) {
      throw new RangeError('maxIterations must be >= 1');
    }
  }

  async handleMessage(request: HandleMessageRequest): Promise<AgentResponse> {
    const startedAt = Date.now();
    const maxIter = this.config.maxIterations ?? DEFAULT_MAX_ITERATIONS;
    const memory = this.config.memory ?? NoopMemoryAdapter;

    // Per-call ExecutionContext — injects agent + projectId that can't be set
    // at construction without leaking runtime identity into the tool layer.
    const ctx: ExecutionContext = {
      ...this.config.executionContext,
      agent: this.config.agent,
      projectId: this.config.projectId,
    };

    const compiled = await memory.compileContext({
      agent: this.config.agent,
      projectId: this.config.projectId,
      ...(request.userId && { userId: request.userId }),
      query: request.message,
    });

    const systemPrompt = buildSystemPrompt(
      this.config.basePromptSections ?? [],
      compiled,
      this.config.agent,
    );

    const messages: Message[] = [
      ...(request.conversation ?? []),
      { role: 'user', content: request.message },
    ];

    const toolDefs = this.buildToolDefs();

    let iteration = 0;
    let toolCallsCount = 0;
    let totalInput = 0;
    let totalOutput = 0;
    let finalText = '';
    let finalStopReason = 'other';
    let stoppedReason: StoppedReason = 'other';
    let consecutiveErrorIterations = 0;

    while (iteration < maxIter) {
      iteration++;

      const resp = await this.config.llmClient.chatSync(messages, {
        system: systemPrompt,
        ...(toolDefs.length > 0 && { tools: toolDefs }),
        ...(this.config.model?.maxTokens !== undefined && {
          maxTokens: this.config.model.maxTokens,
        }),
        ...(this.config.model?.temperature !== undefined && {
          temperature: this.config.model.temperature,
        }),
      });

      this.config.hooks?.onIteration?.(iteration, resp.content);
      totalInput += resp.usage.inputTokens;
      totalOutput += resp.usage.outputTokens;
      finalStopReason = resp.stopReason;

      // Append assistant message.
      messages.push({ role: 'assistant', content: resp.content });

      const toolUses: ToolUseBlock[] = [];
      const textParts: string[] = [];
      for (const block of resp.content) {
        if (block.type === 'tool_use') toolUses.push(block);
        else if (block.type === 'text') textParts.push(block.text);
      }
      finalText = textParts.join('\n');

      if (toolUses.length === 0) {
        stoppedReason = resp.stopReason === 'end_turn' ? 'end_turn' : 'llm_stop_reason';
        break;
      }

      const toolResultBlocks: ContentBlock[] = [];
      let anyError = false;
      for (const tu of toolUses) {
        toolCallsCount++;
        const t0 = Date.now();
        const result = await this.config.toolRegistry.execute(tu.name, tu.input, ctx);
        const durationMs = Date.now() - t0;

        this.config.hooks?.onToolCall?.({
          name: tu.name,
          params: tu.input,
          ok: result.ok,
          ...(result.errorCode && { errorCode: result.errorCode }),
          durationMs,
        });
        if (!result.ok) anyError = true;

        toolResultBlocks.push({
          type: 'tool_result',
          toolUseId: tu.id,
          content: result.output,
          ...(result.ok ? {} : { isError: true }),
        });
      }
      messages.push({ role: 'tool', content: toolResultBlocks });

      consecutiveErrorIterations = anyError ? consecutiveErrorIterations + 1 : 0;
      if (consecutiveErrorIterations >= TOOL_ERROR_CASCADE_THRESHOLD) {
        stoppedReason = 'tool_error_cascade';
        break;
      }
    }

    if (iteration >= maxIter && stoppedReason === 'other') {
      stoppedReason = 'max_iterations';
    }

    const finishedAt = Date.now();

    await memory.recordSession({
      agent: this.config.agent,
      projectId: this.config.projectId,
      ...(request.userId && { userId: request.userId }),
      messages,
      iterations: iteration,
      toolCallsCount,
      tokensUsed: { input: totalInput, output: totalOutput },
      finalText,
      startedAt,
      finishedAt,
      stoppedReason,
    });

    return {
      text: finalText,
      messages,
      iterations: iteration,
      toolCallsCount,
      tokensUsed: { input: totalInput, output: totalOutput },
      finalStopReason,
      stoppedReason,
      startedAt,
      finishedAt,
    };
  }

  /** Snapshot the registered tools into LLM-facing ToolDefs. */
  private buildToolDefs(): ToolDef[] {
    const names = this.config.toolNames ?? this.config.toolRegistry.list();
    const defs: ToolDef[] = [];
    for (const name of names) {
      const tool = this.config.toolRegistry.get(name);
      if (!tool) continue;
      defs.push({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      });
    }
    return defs;
  }
}
