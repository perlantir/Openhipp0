import { useEffect, useState, type ReactElement } from 'react';
import { PageHeader } from '../components/PageHeader.js';

export interface CostRow {
  id: string;
  projectId: string | null;
  agentId: string | null;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}

export interface CostTotals {
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

export interface CostBucket {
  name: string;
  costUsd: number;
  calls: number;
}

export interface CostsPayload {
  rows: CostRow[];
  totals: CostTotals;
  byProvider: CostBucket[];
  byModel: CostBucket[];
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: CostsPayload };

export interface CostsProps {
  fetchCosts?: () => Promise<CostsPayload>;
}

export function Costs({ fetchCosts }: CostsProps = {}): ReactElement {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const data = fetchCosts ? await fetchCosts() : await defaultFetchCosts();
        if (!cancelled) setState({ status: 'ready', data });
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
  }, [fetchCosts]);

  return (
    <>
      <PageHeader title="Costs" subtitle="LLM usage and spend per provider / model." />
      {state.status === 'loading' && (
        <div
          role="status"
          className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
        >
          Loading cost data…
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="rounded border border-dashed border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"
        >
          <p>
            Couldn't reach <code className="font-mono">/api/costs</code>:{' '}
            <span className="font-mono text-amber-700">{state.message}</span>
          </p>
          <p className="mt-2">
            Start the server with <code className="font-mono">hipp0 serve --with-api</code>.
          </p>
        </div>
      )}
      {state.status === 'ready' && <CostsView data={state.data} />}
    </>
  );
}

function CostsView({ data }: { data: CostsPayload }): ReactElement {
  if (data.rows.length === 0) {
    return (
      <div
        data-testid="costs-empty"
        className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
      >
        No LLM usage recorded yet. Usage is written per-call by{' '}
        <code className="font-mono">LLMClient</code> into the{' '}
        <code className="font-mono">llm_usage</code> table.
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Totals totals={data.totals} />
      <Buckets label="Per provider" rows={data.byProvider} testid="costs-by-provider" />
      <Buckets label="Per model" rows={data.byModel} testid="costs-by-model" />
      <RecentRows rows={data.rows.slice(0, 25)} />
    </div>
  );
}

function Totals({ totals }: { totals: CostTotals }): ReactElement {
  return (
    <div
      data-testid="costs-totals"
      className="grid grid-cols-4 gap-3 rounded border border-slate-200 bg-white p-4 text-sm"
    >
      <Stat label="Total spend" value={`$${totals.costUsd.toFixed(4)}`} />
      <Stat label="Calls" value={totals.calls.toString()} />
      <Stat label="Input tokens" value={totals.inputTokens.toLocaleString()} />
      <Stat label="Output tokens" value={totals.outputTokens.toLocaleString()} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 font-mono text-base font-medium">{value}</div>
    </div>
  );
}

function Buckets({
  label,
  rows,
  testid,
}: {
  label: string;
  rows: CostBucket[];
  testid: string;
}): ReactElement {
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="w-full text-sm" data-testid={testid}>
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">{label}</th>
            <th className="px-4 py-2 text-right">Calls</th>
            <th className="px-4 py-2 text-right">Spend (USD)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.name}>
              <td className="px-4 py-2 font-mono text-xs">{r.name}</td>
              <td className="px-4 py-2 text-right font-mono">{r.calls}</td>
              <td className="px-4 py-2 text-right font-mono">${r.costUsd.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentRows({ rows }: { rows: CostRow[] }): ReactElement {
  return (
    <div className="overflow-x-auto rounded border border-slate-200 bg-white">
      <table className="w-full text-sm" data-testid="costs-rows">
        <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-4 py-2">Time</th>
            <th className="px-4 py-2">Provider</th>
            <th className="px-4 py-2">Model</th>
            <th className="px-4 py-2 text-right">Input</th>
            <th className="px-4 py-2 text-right">Output</th>
            <th className="px-4 py-2 text-right">USD</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-2 font-mono text-xs text-slate-600">{r.createdAt}</td>
              <td className="px-4 py-2 font-mono text-xs">{r.provider}</td>
              <td className="px-4 py-2 font-mono text-xs">{r.model}</td>
              <td className="px-4 py-2 text-right font-mono">{r.inputTokens}</td>
              <td className="px-4 py-2 text-right font-mono">{r.outputTokens}</td>
              <td className="px-4 py-2 text-right font-mono">${r.costUsd.toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function defaultFetchCosts(): Promise<CostsPayload> {
  const resp = await fetch('/api/costs');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as CostsPayload;
}
