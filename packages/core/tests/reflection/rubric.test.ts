import { describe, expect, it } from 'vitest';
import { runRubric } from '../../src/reflection/rubric.js';
import type { Message } from '../../src/llm/types.js';

function withToolUse(name: string): Message {
  return {
    role: 'assistant',
    content: [{ type: 'tool_use', id: 't1', name, input: {} }],
  };
}

describe('runRubric', () => {
  it('passes a clean short reply with no tool calls', () => {
    const r = runRubric({
      draft: 'Got it. Deployed to staging.',
      messages: [],
      hadToolCalls: false,
      lastToolResultsHadError: false,
    });
    expect(r.pass).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('flags empty drafts', () => {
    const r = runRubric({
      draft: '   ',
      messages: [],
      hadToolCalls: false,
      lastToolResultsHadError: false,
    });
    expect(r.pass).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('empty-reply');
  });

  it('flags trivial drafts (< TRIVIAL_LENGTH_CHARS)', () => {
    const r = runRubric({
      draft: 'ok',
      messages: [],
      hadToolCalls: false,
      lastToolResultsHadError: false,
    });
    expect(r.pass).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('trivial-reply');
  });

  it('flags placeholder tokens (TODO, lorem ipsum, bracketed fill)', () => {
    for (const draft of [
      'Here is the plan. TODO: fill in step 3.',
      'Placeholder section [fill the body here]',
      'lorem ipsum dolor sit amet consectetur adipiscing',
    ]) {
      const r = runRubric({
        draft,
        messages: [],
        hadToolCalls: false,
        lastToolResultsHadError: false,
      });
      expect(r.pass, `"${draft}" should be flagged`).toBe(false);
      expect(r.issues.map((i) => i.code)).toContain('contains-placeholder');
    }
  });

  it('flags tool-error that the reply does not acknowledge', () => {
    const r = runRubric({
      draft: 'Your answer is 42. Everything worked smoothly.',
      messages: [],
      hadToolCalls: true,
      lastToolResultsHadError: true,
    });
    expect(r.pass).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('tool-error-unacknowledged');
  });

  it('accepts tool-error reply that acknowledges the failure', () => {
    const r = runRubric({
      draft: 'The build failed with an exit code — here is the error output.',
      messages: [],
      hadToolCalls: true,
      lastToolResultsHadError: true,
    });
    expect(r.issues.map((i) => i.code)).not.toContain('tool-error-unacknowledged');
  });

  it('flags cited-missing-tool (claims "I ran X" but no tool_use for X)', () => {
    const r = runRubric({
      draft: 'I ran `file_read` and got the answer.',
      messages: [withToolUse('web_fetch')],
      hadToolCalls: true,
      lastToolResultsHadError: false,
    });
    expect(r.pass).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('cited-missing-tool');
  });

  it('does not flag citation when the tool was actually used', () => {
    const r = runRubric({
      draft: 'I ran `file_read` and got the answer.',
      messages: [withToolUse('file_read')],
      hadToolCalls: true,
      lastToolResultsHadError: false,
    });
    expect(r.issues.map((i) => i.code)).not.toContain('cited-missing-tool');
  });

  it('flags over-long reply with no sentence punctuation', () => {
    const r = runRubric({
      draft: 'a'.repeat(600) + ' and some more text here ',
      messages: [],
      hadToolCalls: false,
      lastToolResultsHadError: false,
    });
    expect(r.issues.map((i) => i.code)).toContain('over-long-without-punctuation');
  });
});
