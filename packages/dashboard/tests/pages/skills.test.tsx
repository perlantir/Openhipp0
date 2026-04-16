import { describe, it, expect } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Skills, type SkillsProps, type SkillRow } from '../../src/pages/Skills.js';

function renderSkills(fetchSkills: SkillsProps['fetchSkills']): void {
  render(
    <MemoryRouter>
      <Skills fetchSkills={fetchSkills} />
    </MemoryRouter>,
  );
}

const sample: SkillRow[] = [
  {
    id: 's1',
    title: 'Summarize PR',
    projectId: 'p1',
    agentId: 'reviewer',
    triggerPattern: '(?i)\\bpull request\\b',
    timesUsed: 17,
    timesImproved: 2,
    createdAt: '2026-04-16T00:00:00Z',
  },
];

describe('Skills page', () => {
  it('renders a table when rows arrive', async () => {
    await act(async () => {
      renderSkills(async () => sample);
    });
    await waitFor(() => expect(screen.getByTestId('skills-table')).toBeTruthy());
    expect(screen.getByText('Summarize PR')).toBeTruthy();
    expect(screen.getByText('17')).toBeTruthy();
    expect(screen.getByText('reviewer')).toBeTruthy();
  });

  it('renders the empty-state when the DB has no rows yet', async () => {
    await act(async () => {
      renderSkills(async () => []);
    });
    await waitFor(() => expect(screen.getByTestId('skills-empty')).toBeTruthy());
  });

  it('renders the error banner on fetch failure', async () => {
    await act(async () => {
      renderSkills(async () => {
        throw new Error('HTTP 500');
      });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('HTTP 500');
  });
});
