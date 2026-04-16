import { describe, it, expect } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Health, type HealthProps, type HealthReport } from '../../src/pages/Health.js';

function renderHealth(fetchHealth: HealthProps['fetchHealth']): void {
  render(
    <MemoryRouter>
      <Health fetchHealth={fetchHealth} pollMs={0} />
    </MemoryRouter>,
  );
}

describe('Health page', () => {
  it('renders uptime + version + feature flags', async () => {
    const report: HealthReport = {
      status: 'ok',
      checks: [],
      uptime: 72,
      version: '0.1.0',
      features: { api: true, ws: false },
    };
    await act(async () => {
      renderHealth(async () => report);
    });
    await waitFor(() => expect(screen.getByTestId('health-view')).toBeTruthy());
    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('1m')).toBeTruthy();
    expect(screen.getByTestId('feature-api').textContent).toContain('on');
    expect(screen.getByTestId('feature-ws').textContent).toContain('off');
  });

  it('renders the check table when checks are present', async () => {
    const report: HealthReport = {
      status: 'warn',
      checks: [
        { name: 'disk', status: 'ok' },
        { name: 'llm-api', status: 'warn', message: 'rate limited' },
      ],
      uptime: 3600,
    };
    await act(async () => {
      renderHealth(async () => report);
    });
    await waitFor(() => expect(screen.getByTestId('health-checks')).toBeTruthy());
    expect(screen.getByText('disk')).toBeTruthy();
    expect(screen.getByText('rate limited')).toBeTruthy();
  });

  it('renders an error banner when /health fails', async () => {
    await act(async () => {
      renderHealth(async () => {
        throw new Error('HTTP 503');
      });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('HTTP 503');
  });
});
