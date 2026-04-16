/**
 * FakeLLMProvider — a deterministic, scripted LLMProvider for E2E tests.
 *
 * Each call to `chatSync` consumes the next step in the script. The script
 * describes what the "LLM" should emit:
 *
 *   { text: '...' }                            → plain assistant reply (end_turn)
 *   { toolUse: { name, input, id? } }          → tool_use request  (stop: tool_use)
 *   { text: '...', toolUse: { ... } }          → combined reply + tool_use
 *
 * When the script is exhausted, every subsequent call returns a short
 * `end_turn` "done" reply — this lets the agent loop terminate cleanly
 * even if the caller under-scripted.
 */

import type { ContentBlock, LLMProvider, Message } from '@openhipp0/core';
import type { llm } from '@openhipp0/core';

type LLMOptions = llm.LLMOptions;
type LLMResponse = llm.LLMResponse;
type StreamChunk = llm.StreamChunk;

export interface LLMScriptStep {
  text?: string;
  toolUse?: { id?: string; name: string; input: Record<string, unknown> };
}

export class FakeLLMProvider implements LLMProvider {
  readonly name = 'fake';
  readonly model = 'fake-test-model';

  private cursor = 0;
  private autoIdCounter = 0;
  readonly calls: Message[][] = [];

  constructor(private readonly script: readonly LLMScriptStep[]) {}

  async chatSync(messages: Message[], _options?: LLMOptions): Promise<LLMResponse> {
    // Record what the runtime actually sent — tests assert on this.
    this.calls.push(messages.map((m) => ({ ...m })));

    const step: LLMScriptStep = this.script[this.cursor++] ?? { text: 'done' };

    const content: ContentBlock[] = [];
    if (step.text) content.push({ type: 'text', text: step.text });
    if (step.toolUse) {
      content.push({
        type: 'tool_use',
        id: step.toolUse.id ?? `tu_${++this.autoIdCounter}`,
        name: step.toolUse.name,
        input: step.toolUse.input,
      });
    }

    return {
      content,
      stopReason: step.toolUse ? 'tool_use' : 'end_turn',
      usage: { inputTokens: 10, outputTokens: 5 },
      model: this.model,
      provider: this.name,
    };
  }

  async *chat(messages: Message[], options?: LLMOptions): AsyncGenerator<StreamChunk, LLMResponse> {
    const resp = await this.chatSync(messages, options);
    yield { type: 'message_stop', stopReason: resp.stopReason, usage: resp.usage };
    return resp;
  }

  countTokens(t: string): number {
    return Math.ceil(t.length / 4);
  }

  /** Remaining un-consumed script steps. 0 = script fully played. */
  remaining(): number {
    return Math.max(0, this.script.length - this.cursor);
  }
}
