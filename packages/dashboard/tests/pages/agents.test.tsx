import { describe, it, expect } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Agents, type AgentsProps, type AgentEntry } from '../../src/pages/Agents.js';

function renderAgents(fetchAgents: AgentsProps['fetchAgents']): void {
  render(
    <MemoryRouter>
      <Agents fetchAgents={fetchAgents} />
    </MemoryRouter>,
  );
}

describe('Agents page', () => {
  it('renders one card per configured agent', async () => {
    const agents: AgentEntry[] = [
      { name: 'writer', domain: 'content', skills: ['gmail', 'notion'] },
      { name: 'reviewer', domain: '', skills: [] },
    ];
    await act(async () => {
      renderAgents(async () => agents);
    });
    await waitFor(() => expect(screen.getByTestId('agent-writer')).toBeTruthy());
    expect(screen.getByText('content')).toBeTruthy();
    expect(screen.getByText('gmail')).toBeTruthy();
    expect(screen.getByText('(no domain)')).toBeTruthy();
    expect(screen.getByText('no skills')).toBeTruthy();
  });

  it('renders the empty-state banner when no agents configured', async () => {
    await act(async () => {
      renderAgents(async () => []);
    });
    await waitFor(() => expect(screen.getByTestId('agents-empty')).toBeTruthy());
  });

  it('renders error fallback when /api/config/agents fails', async () => {
    await act(async () => {
      renderAgents(async () => {
        throw new Error('HTTP 500');
      });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  });
});
