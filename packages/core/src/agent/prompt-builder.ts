/**
 * System-prompt assembly.
 *
 * Layout:
 *   - Header: "You are <name>, acting in the <role> role."
 *   - Base sections (from config.basePromptSections) — role definitions,
 *     tone guidance, hard constraints.
 *   - Compiled sections (from MemoryAdapter.compileContext) — relevant past
 *     decisions, user model snippets, relevant skills.
 *   - Decision protocol footer — advisory markers the agent can emit for
 *     governance-aware callers (see decision-protocol.ts).
 */

import type { AgentIdentity, AgentSystemPromptSection, CompiledContext } from './types.js';

const DECISION_PROTOCOL_FOOTER: AgentSystemPromptSection = {
  title: 'Decision Protocol',
  body: [
    'When your action warrants explicit governance, emit a line of the form',
    '  HIPP0_DECISION: <CODE> [optional argument]',
    'Valid codes:',
    '  PROCEED                  — default; action is routine and safe.',
    '  SKIP                     — declining to act; include reason.',
    '  OVERRIDE_TO <target>     — re-routing to a different agent or tool.',
    '  ASK_FOR_CLARIFICATION    — awaiting a follow-up question.',
    '  AWAIT_APPROVAL           — high-stakes; needs human confirmation.',
    'Only one directive per response. The runtime treats these as advisory.',
  ].join('\n'),
};

export function buildSystemPrompt(
  base: readonly AgentSystemPromptSection[],
  compiled: CompiledContext,
  agent: AgentIdentity,
): string {
  const parts: string[] = [`You are ${agent.name}, acting in the ${agent.role} role.`];
  for (const section of [...base, ...compiled.sections, DECISION_PROTOCOL_FOOTER]) {
    parts.push(`\n## ${section.title}\n${section.body}`);
  }
  return parts.join('\n');
}
