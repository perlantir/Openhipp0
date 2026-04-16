import { PageHeader } from '../components/PageHeader.js';

/** Skills — installed skill catalogue (placeholder). */
export function Skills() {
  return (
    <>
      <PageHeader title="Skills" subtitle="Installed skills across workspace / global / builtin." />
      <div className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500">
        Loaded from the skills engine. Use <code>hipp0 skill list</code> until the API ships.
      </div>
    </>
  );
}
