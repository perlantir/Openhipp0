import { describe, it, expect, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import {
  Settings,
  type SettingsProps,
  type ConfigSnapshot,
} from '../../src/pages/Settings.js';

function renderSettings(props: SettingsProps): void {
  render(
    <MemoryRouter>
      <Settings {...props} />
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
      renderSettings({ fetchConfig: async () => cfg });
    });
    await waitFor(() => expect(screen.getByTestId('settings-view')).toBeTruthy());
    expect(screen.getByText('my-proj')).toBeTruthy();
    expect((screen.getByTestId('llm-provider') as HTMLSelectElement).value).toBe('anthropic');
    expect((screen.getByTestId('llm-model') as HTMLInputElement).value).toBe('claude-sonnet-4');
    expect(screen.getByText('web')).toBeTruthy();
    expect(screen.getByText('telegram')).toBeTruthy();
    expect(screen.getByTestId('kv-agents').textContent).toContain('1');
    expect(screen.getByTestId('kv-cron-tasks').textContent).toContain('0');
  });

  it('renders an error banner when /api/config fails', async () => {
    await act(async () => {
      renderSettings({
        fetchConfig: async () => {
          throw new Error('HTTP 502');
        },
      });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toContain('HTTP 502');
  });

  it('shows "none configured" when bridges array is empty', async () => {
    await act(async () => {
      renderSettings({ fetchConfig: async () => ({ bridges: [] }) });
    });
    await waitFor(() => expect(screen.getByTestId('settings-view')).toBeTruthy());
    expect(screen.getByText('none configured')).toBeTruthy();
  });

  it('submits provider + api key + model and shows success', async () => {
    const saveLlm = vi.fn(async () => ({
      ok: true,
      llm: { provider: 'openai' as const, model: 'gpt-4o-mini' },
      apiKeyUpdated: true,
      hotSwapped: true,
    }));
    await act(async () => {
      renderSettings({
        fetchConfig: async () => ({ llm: { provider: 'anthropic' } }),
        saveLlm,
      });
    });
    await waitFor(() => expect(screen.getByTestId('llm-form')).toBeTruthy());

    fireEvent.change(screen.getByTestId('llm-provider'), { target: { value: 'openai' } });
    fireEvent.change(screen.getByTestId('llm-model'), { target: { value: 'gpt-4o-mini' } });
    fireEvent.change(screen.getByTestId('llm-api-key'), { target: { value: 'sk-new-key-1234' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('llm-save'));
    });

    expect(saveLlm).toHaveBeenCalledWith({
      provider: 'openai',
      model: 'gpt-4o-mini',
      apiKey: 'sk-new-key-1234',
    });
    await waitFor(() => expect(screen.getByTestId('llm-saved')).toBeTruthy());
    expect(screen.getByTestId('llm-saved').textContent).toMatch(/key rotated.*hot-swapped/);
    // API key input cleared on success (defense-in-depth: don't keep plaintext in DOM state).
    expect((screen.getByTestId('llm-api-key') as HTMLInputElement).value).toBe('');
  });

  it('omits apiKey from request when field is left blank', async () => {
    const captured: unknown[] = [];
    const saveLlm = async (req: unknown) => {
      captured.push(req);
      return {
        ok: true,
        llm: { provider: 'anthropic' as const, model: 'claude-sonnet-4-6' },
        apiKeyUpdated: false,
        hotSwapped: true,
      };
    };
    await act(async () => {
      renderSettings({
        fetchConfig: async () => ({ llm: { provider: 'anthropic', model: 'claude-sonnet-4-6' } }),
        saveLlm,
      });
    });
    await waitFor(() => expect(screen.getByTestId('llm-form')).toBeTruthy());
    await act(async () => {
      fireEvent.click(screen.getByTestId('llm-save'));
    });
    expect(captured[0]).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    expect(captured[0]).not.toHaveProperty('apiKey');
    await waitFor(() => expect(screen.getByTestId('llm-saved').textContent).toMatch(/Saved/));
  });

  it('disables the api key field for ollama (local, no key)', async () => {
    await act(async () => {
      renderSettings({
        fetchConfig: async () => ({ llm: { provider: 'anthropic' } }),
        saveLlm: async () => ({
          ok: true,
          llm: { provider: 'ollama' as const },
          apiKeyUpdated: false,
          hotSwapped: false,
        }),
      });
    });
    await waitFor(() => expect(screen.getByTestId('llm-form')).toBeTruthy());
    fireEvent.change(screen.getByTestId('llm-provider'), { target: { value: 'ollama' } });
    expect((screen.getByTestId('llm-api-key') as HTMLInputElement).disabled).toBe(true);
  });

  it('shows an error banner when saveLlm rejects', async () => {
    const saveLlm = vi.fn(async () => {
      throw new Error('reload failed');
    });
    await act(async () => {
      renderSettings({
        fetchConfig: async () => ({ llm: { provider: 'anthropic' } }),
        saveLlm,
      });
    });
    await waitFor(() => expect(screen.getByTestId('llm-form')).toBeTruthy());
    fireEvent.change(screen.getByTestId('llm-api-key'), { target: { value: 'sk-bad-key-xxxx' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('llm-save'));
    });
    await waitFor(() => expect(screen.getByTestId('llm-error')).toBeTruthy());
    expect(screen.getByTestId('llm-error').textContent).toMatch(/reload failed/);
  });
});
