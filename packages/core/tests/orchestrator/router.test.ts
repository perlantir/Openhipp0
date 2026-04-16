import { describe, expect, it } from 'vitest';
import { TaskRouter, type TeamConfig } from '../../src/orchestrator/index.js';

const team: TeamConfig = {
  name: 'hipp0-team',
  agents: [
    {
      name: 'code-agent',
      domain: 'engineering',
      skills: ['typescript', 'python'],
      successRate: 0.8,
      maxConcurrent: 0,
    },
    {
      name: 'ops-agent',
      domain: 'devops',
      skills: ['docker', 'k8s', 'terraform'],
      successRate: 0.7,
      maxConcurrent: 0,
    },
    {
      name: 'data-agent',
      domain: 'analytics',
      skills: ['sql', 'python'],
      successRate: 0.9,
      maxConcurrent: 0,
    },
  ],
  defaultAgent: 'code-agent',
  fallbackToUser: true,
};

describe('TaskRouter', () => {
  it('selects the agent with the best skill match', () => {
    const router = new TaskRouter(team);
    const decision = router.route({ domains: ['docker', 'k8s'] });
    expect(decision.agentName).toBe('ops-agent');
    expect(decision.reason).toBe('skill_match');
    expect(decision.confidence).toBeGreaterThan(0);
  });

  it('breaks ties using successRate', () => {
    const router = new TaskRouter(team);
    // Both code-agent and data-agent have 'python'; data-agent has higher successRate.
    const decision = router.route({ domains: ['python'] });
    expect(decision.agentName).toBe('data-agent');
  });

  it('falls back to defaultAgent when no skills match', () => {
    const router = new TaskRouter(team);
    const decision = router.route({ domains: ['rust'] });
    expect(decision.agentName).toBe('code-agent');
    expect(decision.reason).toBe('default');
  });

  it('returns fallback_user when no skills match and no defaultAgent', () => {
    const noDefault: TeamConfig = { ...team, defaultAgent: undefined };
    const router = new TaskRouter(noDefault);
    const decision = router.route({ domains: ['quantum-computing'] });
    expect(decision.reason).toBe('fallback_user');
    expect(decision.agentName).toBe('');
    expect(decision.confidence).toBe(0);
  });

  it('is case-insensitive on domain matching', () => {
    const router = new TaskRouter(team);
    const decision = router.route({ domains: ['Docker'] });
    expect(decision.agentName).toBe('ops-agent');
  });
});
