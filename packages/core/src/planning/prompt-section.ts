/**
 * Compact plan injection for the system prompt. We deliberately emit ONLY
 * {goal, currentStep, nextStep} per turn — not the full step list — to
 * keep context lean and prevent step-list drift from swamping the agent's
 * working-memory window.
 */

import type { Plan } from './types.js';

export interface PlanPromptSection {
  readonly title: string;
  readonly body: string;
}

export function renderPlanPromptSection(plan: Plan): PlanPromptSection | null {
  if (plan.state !== 'active' && plan.state !== 'draft') return null;
  const current = plan.currentStepId
    ? plan.steps.find((s) => s.id === plan.currentStepId)
    : undefined;
  const remaining = plan.steps.filter((s) => s.status === 'pending' || s.status === 'in_progress');
  const next = remaining.find((s) => s.id !== current?.id);

  const lines = [
    `Plan: ${plan.goal}`,
    `Plan id: ${plan.id}  (use plan.view("${plan.id}") for the full step list)`,
  ];
  if (current) {
    lines.push(`Current step: ${current.description}  [status=${current.status}]`);
  } else {
    lines.push('Current step: (none)');
  }
  if (next) {
    lines.push(`Next step: ${next.description}`);
  }
  lines.push(
    `When a step is done, call plan.progress("<stepId>", "completed", { evidence... }). ` +
      `Evidence is VALIDATED server-side — you cannot mark a step done without it.`,
  );
  return { title: 'Active Plan', body: lines.join('\n') };
}
