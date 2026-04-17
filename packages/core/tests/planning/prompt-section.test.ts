import { describe, expect, it } from 'vitest';
import { renderPlanPromptSection } from '../../src/planning/prompt-section.js';
import type { Plan } from '../../src/planning/types.js';

function mkPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    projectId: 'p1',
    sessionId: null,
    goal: 'Deploy v2',
    state: 'active',
    currentStepId: 'step-a',
    steps: [
      { id: 'step-a', parentStepId: null, order: 0, description: 'Run migrations', status: 'pending' },
      { id: 'step-b', parentStepId: null, order: 1, description: 'Flip feature flag', status: 'pending' },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('renderPlanPromptSection', () => {
  it('compact section: only current + next, not full list', () => {
    const sec = renderPlanPromptSection(mkPlan());
    expect(sec).not.toBeNull();
    expect(sec!.body).toContain('Deploy v2');
    expect(sec!.body).toContain('Current step: Run migrations');
    expect(sec!.body).toContain('Next step: Flip feature flag');
    // Step B (description) shouldn't appear more than once, and step C never.
    expect((sec!.body.match(/Flip feature flag/g) ?? []).length).toBe(1);
  });

  it('mentions plan.view tool + evidence validation', () => {
    const sec = renderPlanPromptSection(mkPlan())!;
    expect(sec.body).toContain('plan.view');
    expect(sec.body).toContain('VALIDATED');
  });

  it('returns null for completed / abandoned plans', () => {
    expect(renderPlanPromptSection(mkPlan({ state: 'completed' }))).toBeNull();
    expect(renderPlanPromptSection(mkPlan({ state: 'abandoned' }))).toBeNull();
  });

  it('handles plans with no current step (all completed but not yet updated)', () => {
    const sec = renderPlanPromptSection(mkPlan({ currentStepId: null }))!;
    expect(sec.body).toContain('Current step: (none)');
  });
});
