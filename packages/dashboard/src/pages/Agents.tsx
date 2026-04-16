import { useEffect, useState, type ReactElement } from 'react';
import { PageHeader } from '../components/PageHeader.js';

export interface AgentEntry {
  name: string;
  domain: string;
  skills: string[];
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; agents: AgentEntry[] };

export interface AgentsProps {
  fetchAgents?: () => Promise<AgentEntry[]>;
}

export function Agents({ fetchAgents }: AgentsProps = {}) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const agents = fetchAgents ? await fetchAgents() : await defaultFetchAgents();
        if (!cancelled) setState({ status: 'ready', agents });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchAgents]);

  return (
    <>
      <PageHeader title="Agents" subtitle="Configured agents and their skill profiles." />
      {state.status === 'loading' && (
        <div
          role="status"
          className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
        >
          Loading agents…
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="rounded border border-dashed border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"
        >
          <p>
            Couldn't reach <code className="font-mono">/api/config/agents</code>:{' '}
            <span className="font-mono text-amber-700">{state.message}</span>
          </p>
          <p className="mt-2">
            Start the server with <code className="font-mono">hipp0 serve --with-api</code>. Add
            an agent via <code className="font-mono">hipp0 agent add &lt;name&gt;</code>.
          </p>
        </div>
      )}
      {state.status === 'ready' && <AgentsView agents={state.agents} />}
    </>
  );
}

function AgentsView({ agents }: { agents: AgentEntry[] }): ReactElement {
  if (agents.length === 0) {
    return (
      <div
        data-testid="agents-empty"
        className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
      >
        No agents configured. Use <code className="font-mono">hipp0 agent add &lt;name&gt;</code>{' '}
        to register one.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {agents.map((a) => (
        <div
          key={a.name}
          data-testid={`agent-${a.name}`}
          className="rounded border border-slate-200 bg-white p-4"
        >
          <div className="flex items-baseline justify-between">
            <h3 className="font-semibold">{a.name}</h3>
            <span className="text-xs text-slate-500">{a.domain || '(no domain)'}</span>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {a.skills.length === 0 ? (
              <span className="text-xs text-slate-500">no skills</span>
            ) : (
              a.skills.map((s) => (
                <span
                  key={s}
                  className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-700"
                >
                  {s}
                </span>
              ))
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

async function defaultFetchAgents(): Promise<AgentEntry[]> {
  const resp = await fetch('/api/config/agents');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as AgentEntry[];
}
