import { describe, it, expect } from 'vitest';
import { heuristicPlan, ScriptedPlanner } from '../../src/browser/planner.js';

describe('heuristicPlan', () => {
  it('parses a navigate + click sequence', () => {
    const actions = heuristicPlan(
      'Go to https://example.com. Then click the Sign In button. Screenshot.',
    );
    expect(actions).toEqual([
      { kind: 'navigate', url: 'https://example.com' },
      { kind: 'click', ref: '@Sign In' },
      { kind: 'screenshot' },
    ]);
  });

  it('parses a type action with quoted text', () => {
    const actions = heuristicPlan('Type "hello world" into Search.');
    expect(actions).toEqual([{ kind: 'type', ref: '@Search', text: 'hello world' }]);
  });

  it('returns an empty plan for anything it cannot parse', () => {
    expect(heuristicPlan('book a dinner reservation at Nobu')).toEqual([]);
  });
});

describe('ScriptedPlanner', () => {
  it('returns its pre-defined actions verbatim', async () => {
    const p = new ScriptedPlanner([
      { kind: 'navigate', url: 'https://a.test' },
      { kind: 'wait', ms: 10 },
    ]);
    const out = await p.plan('anything');
    expect(out).toEqual([
      { kind: 'navigate', url: 'https://a.test' },
      { kind: 'wait', ms: 10 },
    ]);
  });
});
