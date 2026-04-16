import { useEffect, useState, type ReactElement } from 'react';
import { PageHeader } from '../components/PageHeader.js';

export interface AuditEvent {
  id: string;
  projectId: string | null;
  agentId: string | null;
  userId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown>;
  costUsd: number;
  createdAt: string;
}

interface AuditResponse {
  events: AuditEvent[];
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; events: AuditEvent[] };

export interface AuditProps {
  /** Override for tests. */
  fetchEvents?: () => Promise<AuditResponse>;
}

async function defaultFetchEvents(): Promise<AuditResponse> {
  const resp = await fetch('/api/audit?limit=100');
  if (!resp.ok) {
    throw new Error(`/api/audit returned ${resp.status}`);
  }
  return (await resp.json()) as AuditResponse;
}

export function Audit({ fetchEvents }: AuditProps = {}): ReactElement {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const { events } = fetchEvents ? await fetchEvents() : await defaultFetchEvents();
        if (!cancelled) setState({ status: 'ready', events });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchEvents]);

  return (
    <>
      <PageHeader
        title="Audit"
        subtitle="Tool executions, approvals, policy verdicts."
      />
      {state.status === 'loading' && (
        <div
          role="status"
          className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
        >
          Loading audit events…
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
        >
          <p className="font-medium text-slate-700">Audit events unavailable</p>
          <p className="mt-2 text-xs">
            {state.message}. Start the server with <code className="rounded bg-slate-100 px-1 py-0.5">hipp0 serve --with-api</code> and retry.
          </p>
        </div>
      )}
      {state.status === 'ready' && state.events.length === 0 && (
        <div className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500">
          No audit events recorded yet.
        </div>
      )}
      {state.status === 'ready' && state.events.length > 0 && (
        <div className="overflow-hidden rounded border border-slate-200">
          <table className="min-w-full divide-y divide-slate-200 text-sm" data-testid="audit-table">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">When</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Agent</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 text-right font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {state.events.map((e) => (
                <tr key={e.id} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-2 text-slate-600">{formatTime(e.createdAt)}</td>
                  <td className="px-4 py-2 font-mono text-xs text-slate-700">{e.action}</td>
                  <td className="px-4 py-2 text-slate-600">{e.agentId ?? '—'}</td>
                  <td className="px-4 py-2 text-slate-600">
                    {e.targetType ? `${e.targetType}:${e.targetId ?? ''}` : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right text-slate-600">
                    {e.costUsd > 0 ? `$${e.costUsd.toFixed(4)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
