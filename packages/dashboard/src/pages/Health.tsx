import { useEffect, useState, type ReactElement } from 'react';
import { PageHeader } from '../components/PageHeader.js';

export interface HealthReport {
  status: 'ok' | 'warn' | 'fail';
  checks: Array<{ name: string; status: 'ok' | 'warn' | 'fail' | 'skipped'; message?: string }>;
  uptime?: number;
  version?: string;
  features?: { api?: boolean; ws?: boolean };
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; report: HealthReport };

export interface HealthProps {
  fetchHealth?: () => Promise<HealthReport>;
  /** How often to re-poll /health, ms. Default 5000. Pass 0 to disable. */
  pollMs?: number;
}

export function Health({ fetchHealth, pollMs = 5_000 }: HealthProps = {}) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const report = fetchHealth ? await fetchHealth() : await defaultFetchHealth();
        if (!cancelled) setState({ status: 'ready', report });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message });
      }
    };
    void load();
    if (pollMs > 0) {
      const timer = setInterval(() => void load(), pollMs);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [fetchHealth, pollMs]);

  return (
    <>
      <PageHeader title="Health" subtitle="System uptime, feature flags, per-check status." />
      {state.status === 'loading' && (
        <div role="status" className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500">
          Polling /health…
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="rounded border border-dashed border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"
        >
          /health unreachable: <span className="font-mono">{state.message}</span>
        </div>
      )}
      {state.status === 'ready' && <HealthView report={state.report} />}
    </>
  );
}

function HealthView({ report }: { report: HealthReport }): ReactElement {
  return (
    <div className="space-y-4" data-testid="health-view">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card label="Status" value={<StatusPill status={report.status} />} />
        <Card
          label="Uptime"
          value={
            <span className="font-mono text-2xl">
              {report.uptime !== undefined ? formatUptime(report.uptime) : '—'}
            </span>
          }
        />
        <Card
          label="Version"
          value={<span className="font-mono text-2xl">{report.version ?? '—'}</span>}
        />
      </div>
      {report.features && (
        <div className="rounded border border-slate-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-slate-500">Feature flags</div>
          <div className="mt-2 flex gap-3 text-sm">
            <Flag label="api" on={!!report.features.api} />
            <Flag label="ws" on={!!report.features.ws} />
          </div>
        </div>
      )}
      {report.checks.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">
          No checks wired. Register watchdog checks via the HealthRegistry in production.
        </div>
      ) : (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-sm" data-testid="health-checks">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2">Check</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.checks.map((c) => (
                <tr key={c.name}>
                  <td className="px-4 py-2 font-mono">{c.name}</td>
                  <td className="px-4 py-2">
                    <StatusPill status={c.status} />
                  </td>
                  <td className="px-4 py-2 text-slate-600">{c.message ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Card({ label, value }: { label: string; value: ReactElement | string }): ReactElement {
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-2xl">{value}</div>
    </div>
  );
}

function StatusPill({
  status,
}: {
  status: 'ok' | 'warn' | 'fail' | 'skipped';
}): ReactElement {
  const color =
    status === 'ok'
      ? 'bg-emerald-100 text-emerald-800'
      : status === 'warn'
        ? 'bg-amber-100 text-amber-800'
        : status === 'fail'
          ? 'bg-red-100 text-red-800'
          : 'bg-slate-200 text-slate-700';
  return (
    <span className={`rounded px-2 py-0.5 text-xs font-medium ${color}`} data-testid={`status-${status}`}>
      {status}
    </span>
  );
}

function Flag({ label, on }: { label: string; on: boolean }): ReactElement {
  return (
    <span
      className={`rounded px-2 py-0.5 font-mono text-xs ${
        on ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'
      }`}
      data-testid={`feature-${label}`}
    >
      {label}:{on ? 'on' : 'off'}
    </span>
  );
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${(seconds / 3600).toFixed(1)}h`;
  return `${(seconds / 86_400).toFixed(1)}d`;
}

async function defaultFetchHealth(): Promise<HealthReport> {
  const resp = await fetch('/health');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as HealthReport;
}
