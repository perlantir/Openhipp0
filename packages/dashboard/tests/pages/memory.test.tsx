import { describe, it, expect } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Memory, type MemoryProps } from '../../src/pages/Memory.js';

function renderMemory(fetchStats: MemoryProps['fetchStats']): void {
  render(
    <MemoryRouter>
      <Memory fetchStats={fetchStats} />
    </MemoryRouter>,
  );
}

describe('Memory page', () => {
  it('shows row counts once the API responds', async () => {
    const stats = {
      decisions: 42,
      edges: 17,
      memoryEntries: 301,
      sessionHistory: 1024,
      skills: 9,
      userModels: 3,
    };
    await act(async () => {
      renderMemory(async () => stats);
    });
    await waitFor(() => expect(screen.getByText('42')).toBeTruthy());
    expect(screen.getByText('1,024')).toBeTruthy();
    expect(screen.getByTestId('stat-decisions')).toBeTruthy();
    expect(screen.getByTestId('stat-session-turns')).toBeTruthy();
  });

  it('renders a CLI-fallback banner on fetch errors', async () => {
    await act(async () => {
      renderMemory(async () => {
        throw new Error('HTTP 404');
      });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('HTTP 404');
    expect(alert.textContent).toContain('--with-api');
  });

  it('renders a loading indicator before the fetch resolves', () => {
    let resolve: (value: unknown) => void = () => {};
    const pending = new Promise<never>((r) => {
      resolve = r as (v: unknown) => void;
    });
    renderMemory(() => pending);
    expect(screen.getByRole('status')).toBeTruthy();
    resolve({
      decisions: 0,
      edges: 0,
      memoryEntries: 0,
      sessionHistory: 0,
      skills: 0,
      userModels: 0,
    });
  });
});
