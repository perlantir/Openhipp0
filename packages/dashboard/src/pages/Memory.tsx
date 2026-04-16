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

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; stats: MemoryStats };

export interface MemoryProps {
  /** Override for tests. */
  fetchStats?: () => Promise<MemoryStats>;
}

/**
 * Memory page — lists row counts from /api/memory/stats. When the REST API
 * isn't mounted on the current origin (dev or ops who haven't run
 * `hipp0 serve --with-api`), we fall back to the CLI-guidance message.
 */
export function Memory({ fetchStats }: MemoryProps = {}) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const stats = fetchStats ? await fetchStats() : await defaultFetchStats();
        if (!cancelled) setState({ status: 'ready', stats });
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
  }, [fetchStats]);

  return (
    <>
      <PageHeader
        title="Memory"
        subtitle="Decision graph, skills, user models, session history."
      />
      {state.status === 'loading' && (
        <div
          role="status"
          className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
        >
          Loading memory stats…
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="rounded border border-dashed border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"
        >
          <p>
            Couldn't reach <code className="font-mono">/api/memory/stats</code>:{' '}
            <span className="font-mono text-amber-700">{state.message}</span>
          </p>
          <p className="mt-2">
            Start the server with <code className="font-mono">hipp0 serve --with-api</code>{' '}
            (or <code className="font-mono">HIPP0_WITH_API=1</code>) to enable it. Until then
            inspect memory via <code className="font-mono">hipp0 memory stats</code>.
          </p>
        </div>
      )}
      {state.status === 'ready' && <StatsGrid stats={state.stats} />}
    </>
  );
}

function StatsGrid({ stats }: { stats: MemoryStats }): ReactElement {
  const items: Array<[label: string, value: number]> = [
    ['Decisions', stats.decisions],
    ['Edges', stats.edges],
    ['Memory entries', stats.memoryEntries],
    ['Session turns', stats.sessionHistory],
    ['Skills', stats.skills],
    ['User models', stats.userModels],
  ];
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
      {items.map(([label, value]) => (
        <div
          key={label}
          data-testid={`stat-${label.toLowerCase().replace(/\s+/g, '-')}`}
          className="rounded border border-slate-200 bg-white p-4"
        >
          <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
          <div className="mt-1 font-mono text-2xl">{value.toLocaleString()}</div>
        </div>
      ))}
    </div>
  );
}

async function defaultFetchStats(): Promise<MemoryStats> {
  const resp = await fetch('/api/memory/stats');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as MemoryStats;
}
