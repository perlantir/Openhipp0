import { PageHeader } from '../components/PageHeader.js';

/** Settings — config editor (placeholder). */
export function Settings() {
  return (
    <>
      <PageHeader title="Settings" subtitle="Runtime configuration (LLM, bridges, database)." />
      <div className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500">
        Edit via <code>hipp0 config set &lt;key&gt; &lt;value&gt;</code> until the form UI ships.
      </div>
    </>
  );
}
