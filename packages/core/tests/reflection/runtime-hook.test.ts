import { describe, expect, it, vi } from 'vitest';
import {
  maybeCritique,
  assessOutcomeAsync,
  buildRevisionInstruction,
} from '../../src/reflection/runtime-hook.js';
import type {
  Critique,
  OutcomeAssessment,
  ReflectionAdapter,
  ReflectionEventInput,
} from '../../src/reflection/types.js';
import type { AgentIdentity } from '../../src/agent/types.js';

const AGENT: AgentIdentity = { id: 'a', name: 'a', role: 'assistant' };

function commonInput(overrides: Record<string, unknown> = {}) {
  return {
    agent: AGENT,
    userMessage: 'hi',
    draft: 'hello',
    messages: [],
    hadToolCalls: false,
    lastToolResultsHadError: false,
    revisionsUsed: 0,
    projectId: 'p1',
    turnIndex: 1,
    ...overrides,
  };
}

describe('maybeCritique', () => {
  it('skips LLM entirely when adapter is absent', async () => {
    const r = await maybeCritique({ ...commonInput(), adapter: undefined, config: { enabled: true } });
    expect(r.apply).toBe(false);
    expect(r.reason).toBe('no-adapter');
  });

  it('skips LLM when rubric passes + no tool calls (cost guardrail)', async () => {
    const critic = vi.fn<ReflectionAdapter['critiqueDraft']>();
    const r = await maybeCritique({
      ...commonInput({ draft: 'Done — deployed.' }),
      adapter: { critiqueDraft: critic },
      config: { enabled: true },
    });
    expect(r.apply).toBe(false);
    expect(r.reason).toBe('rubric-pass-skip');
    expect(critic).not.toHaveBeenCalled();
  });

  it('invokes critique when tool calls occurred (even on rubric pass)', async () => {
    const critic = vi.fn(
      async (): Promise<Critique> => ({ accept: true, reason: 'fine', confidence: 0.9 }),
    );
    const r = await maybeCritique({
      ...commonInput({ draft: 'Done — deployed.', hadToolCalls: true }),
      adapter: { critiqueDraft: critic },
      config: { enabled: true },
    });
    expect(critic).toHaveBeenCalledOnce();
    expect(r.reason).toBe('llm-accepted');
  });

  it('ignores reject at low confidence (avoid revising on shaky critic)', async () => {
    const critic = vi.fn(
      async (): Promise<Critique> => ({
        accept: false,
        reason: 'needs work',
        confidence: 0.3,
      }),
    );
    const r = await maybeCritique({
      ...commonInput({ draft: 'TODO: fill in', hadToolCalls: false }),
      adapter: { critiqueDraft: critic },
      config: { enabled: true },
    });
    expect(r.apply).toBe(false);
    expect(r.reason).toBe('low-confidence');
  });

  it('applies one revision when critic confidently rejects', async () => {
    const critic = vi.fn(
      async (): Promise<Critique> => ({
        accept: false,
        reason: 'draft contained placeholder',
        suggestions: ['remove TODO, supply real content'],
        confidence: 0.9,
      }),
    );
    const r = await maybeCritique({
      ...commonInput({ draft: 'TODO: fill in' }),
      adapter: { critiqueDraft: critic },
      config: { enabled: true, maxRevisions: 1 },
    });
    expect(r.apply).toBe(true);
    expect(r.reason).toBe('needs-revision');
  });

  it('respects maxRevisions hard cap', async () => {
    const critic = vi.fn(
      async (): Promise<Critique> => ({
        accept: false,
        reason: 'still bad',
        confidence: 0.95,
      }),
    );
    const r = await maybeCritique({
      ...commonInput({ draft: 'TODO', revisionsUsed: 1 }),
      adapter: { critiqueDraft: critic },
      config: { enabled: true, maxRevisions: 1 },
    });
    expect(r.apply).toBe(false);
    expect(critic).not.toHaveBeenCalled();
  });

  it('persists a rubric-only event when no adapter is provided', async () => {
    const persisted: ReflectionEventInput[] = [];
    const r = await maybeCritique({
      ...commonInput({ draft: 'ok' }),
      adapter: undefined,
      config: {
        enabled: false,
        persist: (e) => {
          persisted.push(e);
        },
      },
    });
    expect(r.apply).toBe(false);
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.kind).toBe('critique');
    expect(persisted[0]?.llmInvoked).toBe(false);
  });

  it('survives a critic that throws (returns rubric-only decision)', async () => {
    const critic = vi.fn(async () => {
      throw new Error('network');
    });
    const r = await maybeCritique({
      ...commonInput({ draft: 'TODO: something', hadToolCalls: false }),
      adapter: { critiqueDraft: critic },
      config: { enabled: true },
    });
    expect(r.apply).toBe(false);
  });
});

describe('buildRevisionInstruction', () => {
  it('renders a user-style revision request that references the critique', () => {
    const block = buildRevisionInstruction({
      accept: false,
      reason: 'Draft contained TODO.',
      suggestions: ['replace TODO with actual content', 'keep it short'],
      confidence: 0.9,
    });
    expect(block.type).toBe('text');
    if (block.type === 'text') {
      expect(block.text).toContain('TODO');
      expect(block.text).toContain('replace TODO');
      expect(block.text).toContain('revision process');
    }
  });
});

describe('assessOutcomeAsync', () => {
  it('returns immediately; assessment runs in a microtask and persists', async () => {
    const persisted: ReflectionEventInput[] = [];
    const assess = vi.fn(
      async (): Promise<OutcomeAssessment> => ({
        score: 0.7,
        reason: 'user said thanks',
      }),
    );
    assessOutcomeAsync({
      adapter: { assessOutcome: assess },
      config: {
        enabled: true,
        persist: (e) => {
          persisted.push(e);
        },
      },
      projectId: 'p1',
      agentId: 'a',
      turnIndex: 1,
      request: {
        agent: AGENT,
        prevAssistantText: 'yo',
        nextSignal: { kind: 'user-turn', text: 'thanks' },
      },
    });
    // Force pending microtasks to drain.
    await Promise.resolve();
    await Promise.resolve();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.kind).toBe('outcome');
    expect(persisted[0]?.outcomeScore).toBe(0.7);
  });

  it('swallows assessment errors into a failure-type persisted event', async () => {
    const persisted: ReflectionEventInput[] = [];
    assessOutcomeAsync({
      adapter: {
        assessOutcome: async () => {
          throw new Error('model-broke');
        },
      },
      config: {
        enabled: true,
        persist: (e) => {
          persisted.push(e);
        },
      },
      projectId: 'p1',
      agentId: 'a',
      turnIndex: 1,
      request: {
        agent: AGENT,
        prevAssistantText: 'y',
        nextSignal: { kind: 'session-ended' },
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.reason).toContain('assessment-error');
  });
});
