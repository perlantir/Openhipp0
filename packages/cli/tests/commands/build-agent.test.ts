import { describe, expect, it, beforeEach } from 'vitest';
import type { Message } from '@openhipp0/core';
import type { IncomingMessage, BridgeUser } from '@openhipp0/bridge';
import * as memory from '@openhipp0/memory';
import type { HipppoDb } from '@openhipp0/memory';
import { buildAgentMessageHandler } from '../../src/commands/build-agent.js';

function mkIncoming(text: string, userId = 'u1'): IncomingMessage {
  const user: BridgeUser = { id: userId, name: 'user' };
  return {
    platform: 'web',
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    channel: { id: 'ch1', name: 'test', isDM: true },
    user,
    text,
    timestamp: Date.now(),
    platformData: { frameType: 'message' },
  };
}

describe('buildAgentMessageHandler', () => {
  let db: HipppoDb;
  beforeEach(() => {
    db = memory.db.createClient({ databaseUrl: ':memory:' });
    memory.db.runMigrations(db);
  });

  it('returns undefined when no LLM key is set AND no forceProviders', async () => {
    const prev = { a: process.env['ANTHROPIC_API_KEY'], o: process.env['OPENAI_API_KEY'] };
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
    try {
      const built = await buildAgentMessageHandler({ db });
      expect(built).toBeUndefined();
    } finally {
      if (prev.a) process.env['ANTHROPIC_API_KEY'] = prev.a;
      if (prev.o) process.env['OPENAI_API_KEY'] = prev.o;
    }
  });

  it('routes WS messages through a stubbed LLM provider and replies with the provider output', async () => {
    const built = await buildAgentMessageHandler({
      db,
      forceProviders: [{ type: 'anthropic', model: 'fake-model' }],
      providerFactory: () => ({
        name: 'fake',
        model: 'fake-model',
        async chatSync(messages: Message[]) {
          const last = messages[messages.length - 1];
          const userText =
            typeof last?.content === 'string'
              ? last.content
              : Array.isArray(last?.content)
                ? (last.content.find((b) => b.type === 'text') as { text?: string } | undefined)?.text ?? ''
                : '';
          return {
            content: [{ type: 'text' as const, text: `agent saw: ${userText}` }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 5, outputTokens: 4 },
            model: 'fake-model',
            provider: 'fake',
          };
        },
        async *chat() {
          /* unused */
        },
      } as never),
    });
    expect(built).toBeDefined();

    const out = await built!.handler(mkIncoming('hello world'));
    expect(out).toBeDefined();
    expect(out!.text).toBe('agent saw: hello world');
  });

  it('keeps per-channel conversation history across turns', async () => {
    const sawHistory: string[][] = [];
    const built = await buildAgentMessageHandler({
      db,
      forceProviders: [{ type: 'anthropic', model: 'fake-model' }],
      providerFactory: () => ({
        name: 'fake',
        model: 'fake-model',
        async chatSync(messages: Message[]) {
          sawHistory.push(
            messages
              .filter((m) => m.role !== 'system')
              .map((m) =>
                typeof m.content === 'string' ? m.content : JSON.stringify(m.content).slice(0, 60),
              ),
          );
          return {
            content: [{ type: 'text' as const, text: 'ok' }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
            model: 'fake-model',
            provider: 'fake',
          };
        },
        async *chat() {
          /* unused */
        },
      } as never),
    });

    await built!.handler(mkIncoming('first'));
    await built!.handler(mkIncoming('second'));
    await built!.handler(mkIncoming('third'));

    // First call: agent saw only 'first' as the user turn.
    expect(sawHistory[0]).toEqual(['first']);
    // Second call: history carries "first" (user) + "ok" (assistant) + "second" (user).
    expect(sawHistory[1]).toEqual(['first', 'ok', 'second']);
    // Third: grows further.
    expect(sawHistory[2]?.[0]).toBe('first');
    expect(sawHistory[2]?.at(-1)).toBe('third');
  });

  it('surface agent errors as an inline reply instead of crashing the handler', async () => {
    const built = await buildAgentMessageHandler({
      db,
      forceProviders: [{ type: 'anthropic', model: 'fake-model' }],
      providerFactory: () => ({
        name: 'fake',
        model: 'fake-model',
        async chatSync() {
          throw new Error('model unreachable');
        },
        async *chat() {
          /* unused */
        },
      } as never),
    });

    const out = await built!.handler(mkIncoming('hi'));
    expect(out).toBeDefined();
    expect(out!.text).toMatch(/agent error/i);
  });

  it('auto-creates the project row on first call (no FK error)', async () => {
    const built = await buildAgentMessageHandler({
      db,
      projectId: 'auto-created-proj',
      forceProviders: [{ type: 'anthropic', model: 'fake-model' }],
      providerFactory: () => ({
        name: 'fake',
        model: 'fake-model',
        async chatSync() {
          return {
            content: [{ type: 'text' as const, text: 'hi back' }],
            stopReason: 'end_turn' as const,
            usage: { inputTokens: 1, outputTokens: 1 },
            model: 'fake-model',
            provider: 'fake',
          };
        },
        async *chat() {
          /* unused */
        },
      } as never),
    });
    await built!.handler(mkIncoming('hi'));
    const rows = await db.select().from(memory.db.projects);
    expect(rows.map((r) => r.id)).toContain('auto-created-proj');
  });

  it('exposes reloadProviders that hot-swaps the LLM ladder at runtime', async () => {
    const calls: { msg: string; model: string }[] = [];
    const makeProvider = (model: string) => ({
      name: `fake-${model}`,
      model,
      async chatSync(messages: Message[]) {
        const last = messages[messages.length - 1];
        const text =
          typeof last?.content === 'string'
            ? last.content
            : (last?.content as { type: string; text?: string }[] | undefined)?.find(
                (b) => b.type === 'text',
              )?.text ?? '';
        calls.push({ msg: text, model });
        return {
          content: [{ type: 'text' as const, text: `${model}:${text}` }],
          stopReason: 'end_turn' as const,
          usage: { inputTokens: 1, outputTokens: 1 },
          model,
          provider: `fake-${model}`,
        };
      },
      async *chat() {
        /* unused */
      },
    });
    const built = await buildAgentMessageHandler({
      db,
      forceProviders: [{ type: 'anthropic', model: 'm1' }],
      providerFactory: (cfg) => makeProvider(cfg.model) as never,
    });
    expect(built).toBeDefined();

    const first = await built!.handler(mkIncoming('before'));
    expect(first!.text).toBe('m1:before');

    built!.reloadProviders([{ type: 'anthropic', model: 'm2' }]);

    const second = await built!.handler(mkIncoming('after'));
    expect(second!.text).toBe('m2:after');
    expect(calls.map((c) => c.model)).toEqual(['m1', 'm2']);
  });
});
