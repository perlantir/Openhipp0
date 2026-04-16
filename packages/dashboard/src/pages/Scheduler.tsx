import { useEffect, useState, type ReactElement } from 'react';
import { PageHeader } from '../components/PageHeader.js';

export interface CronTask {
  id: string;
  schedule: string;
  description: string;
  enabled: boolean;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; tasks: CronTask[] };

export interface SchedulerProps {
  /** Override for tests. */
  fetchTasks?: () => Promise<CronTask[]>;
}

export function Scheduler({ fetchTasks }: SchedulerProps = {}) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const tasks = fetchTasks ? await fetchTasks() : await defaultFetchTasks();
        if (!cancelled) setState({ status: 'ready', tasks });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchTasks]);

  return (
    <>
      <PageHeader title="Scheduler" subtitle="Heartbeat cron tasks + webhook triggers." />
      {state.status === 'loading' && (
        <div
          role="status"
          className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
        >
          Loading cron tasks…
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="rounded border border-dashed border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"
        >
          <p>
            Couldn't reach <code className="font-mono">/api/config/cron</code>:{' '}
            <span className="font-mono text-amber-700">{state.message}</span>
          </p>
          <p className="mt-2">
            Start the server with <code className="font-mono">hipp0 serve --with-api</code>. Add
            tasks via <code className="font-mono">hipp0 cron add &lt;id&gt; &lt;schedule&gt;</code>.
          </p>
        </div>
      )}
      {state.status === 'ready' && <TasksView tasks={state.tasks} />}
    </>
  );
}

function TasksView({ tasks }: { tasks: CronTask[] }): ReactElement {
  if (tasks.length === 0) {
    return (
      <div
        data-testid="scheduler-empty"
        className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
      >
        No cron tasks configured. Add one:{' '}
        <code className="font-mono">hipp0 cron add daily-summary "0 9 * * *"</code>
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="w-full text-sm" data-testid="scheduler-table">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">ID</th>
            <th className="px-4 py-2">Schedule</th>
            <th className="px-4 py-2">Description</th>
            <th className="px-4 py-2">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {tasks.map((t) => (
            <tr key={t.id}>
              <td className="px-4 py-2 font-mono">{t.id}</td>
              <td className="px-4 py-2 font-mono">{t.schedule}</td>
              <td className="px-4 py-2 text-slate-600">{t.description || '—'}</td>
              <td className="px-4 py-2">
                {t.enabled ? (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                    enabled
                  </span>
                ) : (
                  <span className="rounded bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600">
                    disabled
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function defaultFetchTasks(): Promise<CronTask[]> {
  const resp = await fetch('/api/config/cron');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as CronTask[];
}
