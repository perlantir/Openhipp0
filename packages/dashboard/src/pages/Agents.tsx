import { PageHeader } from '../components/PageHeader.js';

/** Agents — lists configured agents with their domain + skills. */
export function Agents() {
  return (
    <>
      <PageHeader title="Agents" subtitle="Configured agents and their skill profiles." />
      <div className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500">
        No agents configured. Use <code>hipp0 agent add &lt;name&gt;</code> to register one.
      </div>
    </>
  );
}
