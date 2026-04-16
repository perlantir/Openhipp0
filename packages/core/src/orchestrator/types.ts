/**
 * Multi-agent orchestrator types.
 *
 * A Team is a named collection of agents, each with a domain / skill profile.
 * The Router selects which agent handles a given task based on the agentSkillsProfile
 * table. If no agent matches, the router returns a fallback decision
 * (ask user / use default agent).
 */

import { z } from 'zod';

export const AgentProfileSchema = z.object({
  name: z.string().min(1),
  domain: z.string().min(1),
  /** Domains this agent is good at. Matched against the task's inferred domain. */
  skills: z.array(z.string()).default([]),
  /** Historic success rate (0-1). Used as a tiebreaker when multiple agents match. */
  successRate: z.number().min(0).max(1).default(0.5),
  /** Maximum concurrent tasks this agent should handle. Default unlimited. */
  maxConcurrent: z.number().int().nonnegative().default(0),
});

export type AgentProfile = z.infer<typeof AgentProfileSchema>;

export const TeamConfigSchema = z.object({
  name: z.string().min(1),
  agents: z.array(AgentProfileSchema).min(1),
  /** Default agent name when no profile matches. */
  defaultAgent: z.string().optional(),
  /** Whether to ask the user when routing is ambiguous. Default true. */
  fallbackToUser: z.boolean().default(true),
});

export type TeamConfig = z.infer<typeof TeamConfigSchema>;

export interface RoutingDecision {
  agentName: string;
  /** How the agent was selected. */
  reason: 'skill_match' | 'default' | 'fallback_user';
  /** Confidence score (0-1) based on profile match quality. */
  confidence: number;
}

export class Hipp0OrchestratorError extends Error {
  readonly code: string;
  constructor(message: string, code = 'HIPP0_ORCHESTRATOR_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}
