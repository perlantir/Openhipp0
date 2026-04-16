import { describe, it, expect } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Home, type HomeProps } from '../../src/pages/Home.js';

function renderHome(fetchSnapshot: HomeProps['fetchSnapshot']): void {
  render(
    <MemoryRouter>
      <Home fetchSnapshot={fetchSnapshot} />
    </MemoryRouter>,
  );
}

describe('Home page', () => {
  it('shows live counts once the API responds', async () => {
    const snap = {
      projects: 3,
      decisions: 42,
      skills: 9,
      sessions: 1024,
      calls: 57,
      dailySpend: 1.234,
    };
    await act(async () => {
      renderHome(async () => snap);
    });
    await waitFor(() => expect(screen.getByTestId('stat-projects')).toBeTruthy());
    expect(screen.getByTestId('stat-projects').textContent).toContain('3');
    expect(screen.getByTestId('stat-decisions').textContent).toContain('42');
    expect(screen.getByTestId('stat-skills').textContent).toContain('9');
    expect(screen.getByTestId('stat-sessions').textContent).toContain('1,024');
    expect(screen.getByTestId('stat-calls').textContent).toContain('57');
    expect(screen.getByTestId('stat-spend').textContent).toContain('$1.23');
  });

  it('renders a CLI-fallback banner on fetch errors', async () => {
    await act(async () => {
      renderHome(async () => {
        throw new Error('HTTP 500');
      });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('HTTP 500');
    expect(alert.textContent).toContain('--with-api');
  });

  it('renders a loading indicator before the fetch resolves', () => {
    let resolve: (value: unknown) => void = () => {};
    const pending = new Promise<never>((r) => {
      resolve = r as (v: unknown) => void;
    });
    renderHome(() => pending);
    expect(screen.getByRole('status').textContent).toMatch(/Loading/i);
    // tidy: unresolved promise holds nothing
    void resolve;
  });
});
