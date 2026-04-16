import { describe, it, expect } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Scheduler, type SchedulerProps, type CronTask } from '../../src/pages/Scheduler.js';

function renderScheduler(fetchTasks: SchedulerProps['fetchTasks']): void {
  render(
    <MemoryRouter>
      <Scheduler fetchTasks={fetchTasks} />
    </MemoryRouter>,
  );
}

const sample: CronTask[] = [
  {
    id: 'daily-brief',
    schedule: '0 9 * * *',
    description: 'email morning summary',
    enabled: true,
  },
  {
    id: 'weekly-audit',
    schedule: '0 0 * * 0',
    description: '',
    enabled: false,
  },
];

describe('Scheduler page', () => {
  it('renders a table row per configured task', async () => {
    await act(async () => {
      renderScheduler(async () => sample);
    });
    await waitFor(() => expect(screen.getByTestId('scheduler-table')).toBeTruthy());
    expect(screen.getByText('daily-brief')).toBeTruthy();
    expect(screen.getByText('0 9 * * *')).toBeTruthy();
    expect(screen.getByText('enabled')).toBeTruthy();
    expect(screen.getByText('disabled')).toBeTruthy();
  });

  it('shows an empty-state when no tasks are configured', async () => {
    await act(async () => {
      renderScheduler(async () => []);
    });
    await waitFor(() => expect(screen.getByTestId('scheduler-empty')).toBeTruthy());
  });

  it('shows error fallback when /api/config/cron fails', async () => {
    await act(async () => {
      renderScheduler(async () => {
        throw new Error('HTTP 404');
      });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('/api/config/cron');
  });
});
