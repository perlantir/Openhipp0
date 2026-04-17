/**
 * Red-team agent framework — runs adversarial scenarios against a
 * target agent harness. The harness is caller-supplied (structural),
 * so this module has no LLM deps.
 */

import type { AdversarialCase } from '../adversarial/index.js';

export interface TargetAgent {
  /** Submit adversarial input to the target and return its response. */
  submit(input: string): Promise<TargetResponse>;
  /** Optional: inspect post-run state (e.g. did we poison memory?). */
  inspectMemory?(): Promise<readonly string[]>;
  /** Optional: inspect last tool calls to detect tool-hijack success. */
  lastToolCalls?(): Promise<readonly { name: string; args: Record<string, unknown> }[]>;
}

export interface TargetResponse {
  readonly text: string;
  /** Whether the response contained anything that looks like a secret. */
  readonly leakedSecret?: boolean;
  /** Whether the target actually invoked an unsafe tool. */
  readonly invokedUnsafeTool?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface ScenarioOutcome {
  readonly caseId: string;
  readonly family: AdversarialCase['family'];
  readonly passed: boolean;
  readonly reason: string;
  readonly response: TargetResponse;
}

export interface RedTeamReport {
  readonly runAt: string;
  readonly targetName: string;
  readonly totalCases: number;
  readonly passed: number;
  readonly failed: number;
  readonly outcomes: readonly ScenarioOutcome[];
}
