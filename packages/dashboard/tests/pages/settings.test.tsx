import { describe, it, expect } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Settings, type SettingsProps, type ConfigSnapshot } from '../../src/pages/Settings.js';

function renderSettings(fetchConfig: SettingsProps['fetchConfig']): void {
  render(
    <MemoryRouter>
      <Settings fetchConfig={fetchConfig} />
    </MemoryRouter>,
  );
}

describe('Settings page', () => {
  it('renders project + LLM + bridges sections', async () => {
    const cfg: ConfigSnapshot = {
      project: { name: 'my-proj', createdAt: '2026-04-16T00:00:00Z' },
      llm: { provider: 'anthropic', model: 'claude-sonnet-4' },
      bridges: ['web', 'telegram'],
      database: { type: 'sqlite' },
      agents: [{ name: 'writer', domain: '', skills: [] }],
      cronTasks: [],
    };
    await act(async () => {
      renderSettings(async () => cfg);
    });
    await waitFor(() => expect(screen.getByTestId('settings-view')).toBeTruthy());
    expect(screen.getByText('my-proj')).toBeTruthy();
    expect(screen.getByText('anthropic')).toBeTruthy();
    expect(screen.getByText('claude-sonnet-4')).toBeTruthy();
    expect(screen.getByText('web')).toBeTruthy();
    expect(screen.getByText('telegram')).toBeTruthy();
    // summary counts rendered
    expect(screen.getByTestId('kv-agents').textContent).toContain('1');
    expect(screen.getByTestId('kv-cron-tasks').textContent).toContain('0');
  });

  it('renders an error banner when /api/config fails', async () => {
    await act(async () => {
      renderSettings(async () => {
        throw new Error('HTTP 502');
      });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('HTTP 502');
  });

  it('shows "none configured" when bridges array is empty', async () => {
    await act(async () => {
      renderSettings(async () => ({ bridges: [] }));
    });
    await waitFor(() => expect(screen.getByTestId('settings-view')).toBeTruthy());
    expect(screen.getByText('none configured')).toBeTruthy();
  });
});
