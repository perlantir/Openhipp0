import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Costs, type CostsPayload } from '../../src/pages/Costs.js';

const fakeData: CostsPayload = {
  rows: [
    {
      id: 'u1',
      projectId: 'p',
      agentId: 'a',
      provider: 'anthropic',
      model: 'haiku',
      inputTokens: 100,
      outputTokens: 50,
      costUsd: 0.001,
      createdAt: '2026-04-16T10:00:00Z',
    },
  ],
  totals: { costUsd: 0.001, inputTokens: 100, outputTokens: 50, calls: 1 },
  byProvider: [{ name: 'anthropic', costUsd: 0.001, calls: 1 }],
  byModel: [{ name: 'anthropic:haiku', costUsd: 0.001, calls: 1 }],
};

describe('Costs', () => {
  it('renders loading state initially', () => {
    render(<Costs fetchCosts={() => new Promise(() => {})} />);
    expect(screen.getByRole('status').textContent?.toLowerCase()).toContain('loading');
  });

  it('renders error state on fetch failure', async () => {
    render(<Costs fetchCosts={async () => { throw new Error('nope'); }} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/nope/);
  });

  it('renders empty state when no rows', async () => {
    render(<Costs fetchCosts={async () => ({ ...fakeData, rows: [] })} />);
    await waitFor(() => expect(screen.getByTestId('costs-empty')).toBeTruthy());
  });

  it('renders totals + provider/model breakdown + row table', async () => {
    render(<Costs fetchCosts={async () => fakeData} />);
    await waitFor(() => expect(screen.getByTestId('costs-totals')).toBeTruthy());
    expect(screen.getByTestId('costs-by-provider').textContent).toMatch(/anthropic/);
    expect(screen.getByTestId('costs-by-model').textContent).toMatch(/haiku/);
    expect(screen.getByTestId('costs-rows').textContent).toMatch(/anthropic/);
  });
});
