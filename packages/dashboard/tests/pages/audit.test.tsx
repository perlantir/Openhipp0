import { describe, it, expect } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Audit, type AuditProps, type AuditEvent } from '../../src/pages/Audit.js';

function renderAudit(fetchEvents: AuditProps['fetchEvents']): void {
  render(
    <MemoryRouter>
      <Audit fetchEvents={fetchEvents} />
    </MemoryRouter>,
  );
}

const SAMPLE: AuditEvent[] = [
  {
    id: 'a1',
    projectId: 'proj',
    agentId: 'claude',
    userId: 'user',
    action: 'tool.execute',
    targetType: 'tool',
    targetId: 'search_memory',
    details: {},
    costUsd: 0.0012,
    createdAt: '2026-04-16T12:30:00Z',
  },
  {
    id: 'a2',
    projectId: 'proj',
    agentId: 'claude',
    userId: null,
    action: 'approval.decide',
    targetType: 'approval',
    targetId: 'req-42',
    details: { decision: 'approved' },
    costUsd: 0,
    createdAt: '2026-04-16T12:35:00Z',
  },
];

describe('Audit page', () => {
  it('renders a table once events load', async () => {
    await act(async () => {
      renderAudit(async () => ({ events: SAMPLE }));
    });
    await waitFor(() => expect(screen.getByTestId('audit-table')).toBeTruthy());
    expect(screen.getByText('tool.execute')).toBeTruthy();
    expect(screen.getByText('approval.decide')).toBeTruthy();
    expect(screen.getByText('$0.0012')).toBeTruthy();
  });

  it('shows empty state when there are no events', async () => {
    await act(async () => {
      renderAudit(async () => ({ events: [] }));
    });
    await waitFor(() => expect(screen.getByText(/no audit events/i)).toBeTruthy());
  });

  it('shows an error banner with --with-api hint on fetch failure', async () => {
    await act(async () => {
      renderAudit(async () => {
        throw new Error('HTTP 404');
      });
    });
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('HTTP 404');
    expect(alert.textContent).toContain('--with-api');
  });

  it('shows a loading indicator before the fetch resolves', () => {
    const pending = new Promise<never>(() => undefined);
    renderAudit(() => pending);
    expect(screen.getByRole('status')).toBeTruthy();
  });
});
