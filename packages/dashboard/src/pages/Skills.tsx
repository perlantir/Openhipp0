import { useEffect, useState, type ReactElement } from 'react';
import { PageHeader } from '../components/PageHeader.js';

export interface SkillRow {
  id: string;
  title: string;
  projectId: string;
  agentId: string;
  triggerPattern: string | null;
  timesUsed: number;
  timesImproved: number;
  createdAt: string;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: SkillRow[] };

export interface SkillsProps {
  /** Override for tests. */
  fetchSkills?: () => Promise<SkillRow[]>;
}

export function Skills({ fetchSkills }: SkillsProps = {}) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const rows = fetchSkills ? await fetchSkills() : await defaultFetchSkills();
        if (!cancelled) setState({ status: 'ready', rows });
      } catch (err) {
        if (!cancelled) {
          setState({ status: 'error', message: (err as Error).message });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchSkills]);

  return (
    <>
      <PageHeader
        title="Skills"
        subtitle="Installed skills across workspace / global / builtin."
      />
      {state.status === 'loading' && (
        <div
          role="status"
          className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
        >
          Loading skills…
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="rounded border border-dashed border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"
        >
          <p>
            Couldn't reach <code className="font-mono">/api/skills</code>:{' '}
            <span className="font-mono text-amber-700">{state.message}</span>
          </p>
          <p className="mt-2">
            Start the server with <code className="font-mono">hipp0 serve --with-api</code>. Until
            then inspect via <code className="font-mono">hipp0 skill list</code>.
          </p>
        </div>
      )}
      {state.status === 'ready' && <SkillsTable rows={state.rows} />}
    </>
  );
}

function SkillsTable({ rows }: { rows: SkillRow[] }): ReactElement {
  if (rows.length === 0) {
    return (
      <div
        data-testid="skills-empty"
        className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
      >
        No skills recorded yet. Skills the agent auto-creates land here;
        built-in skills live under <code className="font-mono">skills/</code> and are loaded
        via <code className="font-mono">hipp0 skill audit</code>.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="w-full text-sm" data-testid="skills-table">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Title</th>
            <th className="px-4 py-2">Agent</th>
            <th className="px-4 py-2">Trigger</th>
            <th className="px-4 py-2 text-right">Used</th>
            <th className="px-4 py-2 text-right">Improved</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="px-4 py-2 font-medium">{row.title}</td>
              <td className="px-4 py-2 font-mono text-xs text-slate-600">{row.agentId}</td>
              <td className="px-4 py-2 font-mono text-xs text-slate-600">
                {row.triggerPattern ?? '—'}
              </td>
              <td className="px-4 py-2 text-right font-mono">{row.timesUsed}</td>
              <td className="px-4 py-2 text-right font-mono">{row.timesImproved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function defaultFetchSkills(): Promise<SkillRow[]> {
  const resp = await fetch('/api/skills');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as SkillRow[];
}
