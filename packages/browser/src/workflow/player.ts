/**
 * Workflow player — executes a recorded `Workflow` against a live page.
 * When a selector fails, invokes the caller-supplied `SelectorHealer` (an
 * LLM-backed fallback typically wires to `@openhipp0/core/llm`) and
 * retries with the healed selector.
 */

import type { browser } from '@openhipp0/core';

import { substituteParameters } from './recorder.js';
import type { PlayOptions, PlayResult, RecordedStep, Workflow } from './types.js';

export async function playWorkflow(
  workflow: Workflow,
  page: browser.BrowserPage,
  opts: PlayOptions = {},
): Promise<PlayResult> {
  const params = opts.parameters ?? {};
  const healerAttempts = opts.healerAttempts ?? 1;
  const timeout = opts.actionTimeoutMs ?? 10_000;
  const healedSteps: PlayResult['healedSteps'] = [];
  let completed = 0;

  for (let i = 0; i < workflow.steps.length; i++) {
    const step = workflow.steps[i]!;
    const substituted = substituteStep(step, params);
    try {
      await runStep(page, substituted, timeout);
      completed += 1;
      continue;
    } catch (err) {
      let lastError = (err as Error).message;
      let healed: string | null = null;
      if (opts.healer && substituted.target) {
        for (let attempt = 0; attempt < healerAttempts; attempt++) {
          try {
            const next = await opts.healer({ step: substituted, error: lastError });
            if (next && next !== substituted.target) {
              healed = next;
              await runStep(page, { ...substituted, target: next }, timeout);
              (healedSteps as Array<{ index: number; original: string; healed: string }>).push({
                index: i,
                original: substituted.target,
                healed: next,
              });
              break;
            }
          } catch (err2) {
            lastError = (err2 as Error).message;
          }
        }
      }
      if (!healed) {
        return { ok: false, completed, failedAt: i, error: lastError, healedSteps };
      }
      completed += 1;
    }
  }

  return { ok: true, completed, healedSteps };
}

function substituteStep(step: RecordedStep, params: Readonly<Record<string, string>>): RecordedStep {
  const next: RecordedStep = {
    ...step,
    ...(step.target ? { target: substituteParameters(step.target, params) ?? step.target } : {}),
    ...(step.value ? { value: substituteParameters(step.value, params) ?? step.value } : {}),
    ...(step.url ? { url: substituteParameters(step.url, params) ?? step.url } : {}),
  };
  return next;
}

async function runStep(page: browser.BrowserPage, step: RecordedStep, timeoutMs: number): Promise<void> {
  switch (step.kind) {
    case 'navigate':
      if (!step.url) throw new Error('navigate step missing url');
      await page.goto(step.url, { timeout: timeoutMs });
      return;
    case 'click':
      if (!step.target) throw new Error('click step missing target');
      await page.click(step.target, { timeout: timeoutMs });
      return;
    case 'type':
      if (!step.target) throw new Error('type step missing target');
      await page.fill(step.target, step.value ?? '');
      return;
    case 'select':
      if (!step.target || step.value === undefined) throw new Error('select step missing target/value');
      await page.selectOption(step.target, step.value);
      return;
    case 'scroll':
      await page.mouse.wheel(0, step.magnitude ?? 0);
      return;
    case 'wait':
      await page.waitForTimeout(step.magnitude ?? 0);
      return;
    case 'extract':
      // No side-effect — capture is the caller's responsibility via
      // capturePageSnapshot. Player treats extract as a no-op.
      return;
    default:
      throw new Error(`unknown step kind: ${String((step as RecordedStep).kind)}`);
  }
}
