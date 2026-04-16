import { useEffect, useState, type ReactElement } from 'react';
import { PageHeader } from '../components/PageHeader.js';

interface MemoryStats {
  decisions: number;
  edges: number;
  memoryEntries: number;
  sessionHistory: number;
  skills: number;
  userModels: number;
}

interface CostsTotals {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

interface HomeSnapshot {
  projects: number;
  decisions: number;
  skills: number;
  sessions: number;
  dailySpend: number;
  calls: number;
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; snap: HomeSnapshot };

export interface HomeProps {
  fetchSnapshot?: () => Promise<HomeSnapshot>;
}

/**
 * Home — dashboard overview. Pulls live counts from:
 *   GET /api/memory/stats  (decisions, skills, sessions)
 *   GET /api/projects      (project count)
 *   GET /api/costs         (daily spend, total calls)
 *
 * Any endpoint reachable counts — failures on individual endpoints surface
 * as the error state for the whole snapshot (all-or-nothing is honest;
 * showing mixed partial data would mislead).
 */
export function Home({ fetchSnapshot }: HomeProps = {}) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const snap = fetchSnapshot ? await fetchSnapshot() : await defaultFetchSnapshot();
        if (!cancelled) setState({ status: 'ready', snap });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [fetchSnapshot]);

  return (
    <>
      <PageHeader title="Overview" subtitle="Live counts from the running hipp0 server." />
      {state.status === 'loading' && (
        <div
          role="status"
          className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
        >
          Loading overview…
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="rounded border border-dashed border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"
        >
          <p>
            Couldn't load the overview:{' '}
            <span className="font-mono text-amber-700">{state.message}</span>
          </p>
          <p className="mt-2">
            Start the server with <code className="font-mono">hipp0 serve --with-api</code>{' '}
            (or <code className="font-mono">HIPP0_WITH_API=1</code>). Inspect state via{' '}
            <code className="font-mono">hipp0 memory stats</code>.
          </p>
        </div>
      )}
      {state.status === 'ready' && <SummaryGrid snap={state.snap} />}
    </>
  );
}

function SummaryGrid({ snap }: { snap: HomeSnapshot }): ReactElement {
  const stats: Array<[label: string, value: string, testId: string]> = [
    ['Projects', snap.projects.toLocaleString(), 'stat-projects'],
    ['Decisions', snap.decisions.toLocaleString(), 'stat-decisions'],
    ['Skills', snap.skills.toLocaleString(), 'stat-skills'],
    ['Sessions', snap.sessions.toLocaleString(), 'stat-sessions'],
    ['LLM calls', snap.calls.toLocaleString(), 'stat-calls'],
    ['Daily spend', formatUsd(snap.dailySpend), 'stat-spend'],
  ];
  return (
    <dl className="grid grid-cols-2 gap-4 md:grid-cols-3">
      {stats.map(([label, value, testId]) => (
        <div
          key={label}
          data-testid={testId}
          className="rounded-lg border border-slate-200 bg-slate-50 p-4"
        >
          <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
          <dd className="mt-2 text-2xl font-semibold text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function formatUsd(v: number): string {
  return `$${v.toFixed(2)}`;
}

async function defaultFetchSnapshot(): Promise<HomeSnapshot> {
  const [statsResp, projectsResp, costsResp] = await Promise.all([
    fetch('/api/memory/stats'),
    fetch('/api/projects'),
    fetch('/api/costs'),
  ]);
  if (!statsResp.ok) throw new Error(`/api/memory/stats HTTP ${statsResp.status}`);
  if (!projectsResp.ok) throw new Error(`/api/projects HTTP ${projectsResp.status}`);
  if (!costsResp.ok) throw new Error(`/api/costs HTTP ${costsResp.status}`);

  const stats = (await statsResp.json()) as MemoryStats;
  const projects = (await projectsResp.json()) as Array<{ id: string }>;
  const costs = (await costsResp.json()) as { totals: CostsTotals };
  return {
    projects: projects.length,
    decisions: stats.decisions,
    skills: stats.skills,
    sessions: stats.sessionHistory,
    dailySpend: costs.totals?.costUsd ?? 0,
    calls: costs.totals?.calls ?? 0,
  };
}
