/**
 * TaskRouter — selects the best agent for a given task based on skill overlap
 * and historic success rate.
 *
 * Algorithm:
 *   1. Score each agent by the intersection of task domains ∩ agent skills.
 *   2. Weight by successRate (acts as a tiebreaker).
 *   3. If no agent matches and a defaultAgent is configured, use it.
 *   4. Otherwise, return 'fallback_user' so the caller can ask the operator.
 */

import type { AgentProfile, RoutingDecision, TeamConfig } from './types.js';

export interface TaskDescriptor {
  /** Inferred domains / tags for the task. */
  domains: readonly string[];
  /** Free-text summary (currently unused; future: LLM-classified). */
  summary?: string;
}

export class TaskRouter {
  private readonly agents: readonly AgentProfile[];
  private readonly defaultAgent: string | undefined;
  private readonly fallbackToUser: boolean;

  constructor(config: TeamConfig) {
    this.agents = config.agents;
    this.defaultAgent = config.defaultAgent;
    this.fallbackToUser = config.fallbackToUser;
  }

  route(task: TaskDescriptor): RoutingDecision {
    const taskDomains = new Set(task.domains.map((d) => d.toLowerCase()));
    let best: { agent: AgentProfile; score: number } | undefined;

    for (const agent of this.agents) {
      const overlap = agent.skills.filter((s) => taskDomains.has(s.toLowerCase())).length;
      if (overlap === 0) continue;
      const score = overlap + agent.successRate;
      if (!best || score > best.score) {
        best = { agent, score };
      }
    }

    if (best) {
      return {
        agentName: best.agent.name,
        reason: 'skill_match',
        confidence: Math.min(1, best.score / (taskDomains.size + 1)),
      };
    }

    if (this.defaultAgent) {
      return { agentName: this.defaultAgent, reason: 'default', confidence: 0.5 };
    }

    if (this.fallbackToUser) {
      return { agentName: '', reason: 'fallback_user', confidence: 0 };
    }

    // Shouldn't happen (fallbackToUser defaults to true), but cover the case.
    return { agentName: this.agents[0]?.name ?? '', reason: 'default', confidence: 0.1 };
  }
}
