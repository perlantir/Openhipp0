import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { PageHeader } from '../components/PageHeader.js';
import {
  updateLlmConfig,
  type LlmProvider,
  type UpdateLlmRequest,
  type UpdateLlmResponse,
} from '../api/config.js';

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
  /** Override the save mutation — tests pass a stub; production defaults to updateLlmConfig. */
  saveLlm?: (req: UpdateLlmRequest) => Promise<UpdateLlmResponse>;
}

export function Settings({ fetchConfig, saveLlm }: SettingsProps = {}) {
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

  const onLlmSaved = (resp: UpdateLlmResponse): void => {
    if (state.status !== 'ready') return;
    setState({
      status: 'ready',
      config: {
        ...state.config,
        llm: { provider: resp.llm.provider, ...(resp.llm.model && { model: resp.llm.model }) },
      },
    });
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Runtime configuration (LLM, bridges, database)." />
      {state.status === 'loading' && (
        <div
          role="status"
          className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500"
        >
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
        </div>
      )}
      {state.status === 'ready' && (
        <ConfigView config={state.config} saveLlm={saveLlm} onLlmSaved={onLlmSaved} />
      )}
    </>
  );
}

function ConfigView({
  config,
  saveLlm,
  onLlmSaved,
}: {
  config: ConfigSnapshot;
  saveLlm?: SettingsProps['saveLlm'];
  onLlmSaved: (resp: UpdateLlmResponse) => void;
}): ReactElement {
  return (
    <div className="space-y-4" data-testid="settings-view">
      <Section title="Project">
        <KV k="Name" v={config.project?.name ?? '—'} />
        <KV k="Created" v={config.project?.createdAt ?? '—'} />
      </Section>
      <LlmSection
        currentProvider={(config.llm?.provider as LlmProvider | undefined) ?? 'anthropic'}
        currentModel={config.llm?.model}
        saveLlm={saveLlm}
        onSaved={onLlmSaved}
      />
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
    </div>
  );
}

type SaveState =
  | { status: 'idle' }
  | { status: 'saving' }
  | { status: 'saved'; hotSwapped: boolean; apiKeyUpdated: boolean }
  | { status: 'error'; message: string };

/**
 * LLM section renders an editable form: provider select, API key input
 * (password field; left blank keeps the existing key), model free-text.
 * Save posts to `/api/config/llm` via the injected mutation and updates the
 * parent's ConfigSnapshot on success so the UI reflects the new state
 * without a page refresh.
 */
function LlmSection({
  currentProvider,
  currentModel,
  saveLlm,
  onSaved,
}: {
  currentProvider: LlmProvider;
  currentModel?: string;
  saveLlm?: SettingsProps['saveLlm'];
  onSaved: (resp: UpdateLlmResponse) => void;
}): ReactElement {
  const [provider, setProvider] = useState<LlmProvider>(currentProvider);
  const [apiKey, setApiKey] = useState<string>('');
  const [model, setModel] = useState<string>(currentModel ?? '');
  const [state, setState] = useState<SaveState>({ status: 'idle' });

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setState({ status: 'saving' });
    const req: UpdateLlmRequest = { provider };
    if (apiKey.trim()) req.apiKey = apiKey.trim();
    if (model.trim()) req.model = model.trim();
    try {
      const resp = await (saveLlm ? saveLlm(req) : updateLlmConfig(req));
      setState({
        status: 'saved',
        hotSwapped: resp.hotSwapped,
        apiKeyUpdated: resp.apiKeyUpdated,
      });
      setApiKey(''); // clear the input so we don't keep the plaintext in DOM state
      onSaved(resp);
    } catch (err) {
      setState({ status: 'error', message: (err as Error).message });
    }
  };

  const needsKey = provider !== 'ollama';

  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">LLM</div>
      <form onSubmit={onSubmit} data-testid="llm-form" className="mt-3 space-y-3">
        <div className="flex items-center gap-3 text-sm">
          <label htmlFor="llm-provider" className="w-32 text-slate-500">
            Provider
          </label>
          <select
            id="llm-provider"
            data-testid="llm-provider"
            className="rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            value={provider}
            onChange={(e) => setProvider(e.target.value as LlmProvider)}
          >
            <option value="anthropic">anthropic</option>
            <option value="openai">openai</option>
            <option value="ollama">ollama (local)</option>
          </select>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label htmlFor="llm-model" className="w-32 text-slate-500">
            Model
          </label>
          <input
            id="llm-model"
            data-testid="llm-model"
            type="text"
            className="w-64 rounded border border-slate-300 px-2 py-1 font-mono text-sm"
            value={model}
            placeholder="(default for provider)"
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3 text-sm">
          <label htmlFor="llm-api-key" className="w-32 text-slate-500">
            API key
          </label>
          <input
            id="llm-api-key"
            data-testid="llm-api-key"
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            disabled={!needsKey}
            className="w-64 rounded border border-slate-300 px-2 py-1 font-mono text-sm disabled:bg-slate-100"
            value={apiKey}
            placeholder={needsKey ? 'enter new key (leave blank to keep current)' : 'n/a — local runtime'}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            data-testid="llm-save"
            disabled={state.status === 'saving'}
            className="rounded bg-slate-900 px-3 py-1 text-sm text-white disabled:opacity-50"
          >
            {state.status === 'saving' ? 'Saving…' : 'Save'}
          </button>
          {state.status === 'saved' && (
            <span role="status" data-testid="llm-saved" className="text-xs text-emerald-700">
              Saved{state.apiKeyUpdated ? ' + key rotated' : ''}
              {state.hotSwapped ? ' — hot-swapped live' : ' — restart daemon to apply'}.
            </span>
          )}
          {state.status === 'error' && (
            <span role="alert" data-testid="llm-error" className="text-xs text-rose-700">
              Save failed: {state.message}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactElement | ReactElement[];
}): ReactElement {
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
