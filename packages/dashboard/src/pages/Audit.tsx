import { PageHeader } from '../components/PageHeader.js';

/** Audit — tool calls, approvals, policy decisions (placeholder). */
export function Audit() {
  return (
    <>
      <PageHeader title="Audit" subtitle="Tool executions, approvals, policy verdicts." />
      <div className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500">
        Audit log rows are written on every tool call. The timeline UI ships with the Phase 8 API.
      </div>
    </>
  );
}
