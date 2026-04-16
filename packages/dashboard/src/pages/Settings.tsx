import { useEffect, useState, type ReactElement } from 'react';
import { PageHeader } from '../components/PageHeader.js';

export interface ConfigSnapshot {
  project?: { name: string; createdAt: string };
  llm?: { provider: string; model?: string };
  bridges?: string[];
  database?: { type: string };
  agents?: Array<{ name: string; domain: string; skills: string[] }>;
  cronTasks?: unknown[];
}

type FetchState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; config: ConfigSnapshot };

export interface SettingsProps {
  fetchConfig?: () => Promise<ConfigSnapshot>;
}

export function Settings({ fetchConfig }: SettingsProps = {}) {
  const [state, setState] = useState<FetchState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const config = fetchConfig ? await fetchConfig() : await defaultFetchConfig();
        if (!cancelled) setState({ status: 'ready', config });
      } catch (err) {
        if (!cancelled) setState({ status: 'error', message: (err as Error).message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchConfig]);

  return (
    <>
      <PageHeader title="Settings" subtitle="Runtime configuration (LLM, bridges, database)." />
      {state.status === 'loading' && (
        <div role="status" className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500">
          Loading config…
        </div>
      )}
      {state.status === 'error' && (
        <div
          role="alert"
          className="rounded border border-dashed border-amber-300 bg-amber-50 p-6 text-sm text-amber-900"
        >
          Couldn't reach <code className="font-mono">/api/config</code>:{' '}
          <span className="font-mono">{state.message}</span>.
          Edit config via <code className="font-mono">hipp0 config set &lt;key&gt; &lt;value&gt;</code>.
        </div>
      )}
      {state.status === 'ready' && <ConfigView config={state.config} />}
    </>
  );
}

function ConfigView({ config }: { config: ConfigSnapshot }): ReactElement {
  return (
    <div className="space-y-4" data-testid="settings-view">
      <Section title="Project">
        <KV k="Name" v={config.project?.name ?? '—'} />
        <KV k="Created" v={config.project?.createdAt ?? '—'} />
      </Section>
      <Section title="LLM">
        <KV k="Provider" v={config.llm?.provider ?? '—'} />
        <KV k="Model" v={config.llm?.model ?? '(default for provider)'} />
      </Section>
      <Section title="Bridges">
        <div className="flex flex-wrap gap-1">
          {(config.bridges ?? []).map((b) => (
            <span key={b} className="rounded bg-slate-100 px-2 py-0.5 font-mono text-xs">
              {b}
            </span>
          ))}
          {(!config.bridges || config.bridges.length === 0) && (
            <span className="text-sm text-slate-500">none configured</span>
          )}
        </div>
      </Section>
      <Section title="Database">
        <KV k="Type" v={config.database?.type ?? 'sqlite'} />
      </Section>
      <Section title="Summary">
        <KV k="Agents" v={String((config.agents ?? []).length)} />
        <KV k="Cron tasks" v={String((config.cronTasks ?? []).length)} />
      </Section>
      <div className="rounded border border-dashed border-slate-300 p-4 text-sm text-slate-500">
        Edit values via <code className="font-mono">hipp0 config set &lt;key&gt; &lt;value&gt;</code>{' '}
        — an in-dashboard editor is on the deferred work list (see
        DEVELOPER_HANDOFF.md).
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactElement | ReactElement[] }): ReactElement {
  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-2 space-y-1">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }): ReactElement {
  return (
    <div className="flex gap-4 text-sm" data-testid={`kv-${k.toLowerCase().replace(/\s+/g, '-')}`}>
      <span className="w-32 text-slate-500">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  );
}

async function defaultFetchConfig(): Promise<ConfigSnapshot> {
  const resp = await fetch('/api/config');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return (await resp.json()) as ConfigSnapshot;
}
