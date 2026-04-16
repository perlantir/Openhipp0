import { PageHeader } from '../components/PageHeader.js';

/** Memory — decision graph visualization (placeholder). */
export function Memory() {
  return (
    <>
      <PageHeader
        title="Memory"
        subtitle="Decision graph, skills, user models, session history."
      />
      <div className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500">
        Graph visualization lands with the Phase 8 API wiring. For now, inspect memory via
        <code className="mx-1">hipp0 memory stats</code>and
        <code className="mx-1">hipp0 memory search &lt;query&gt;</code>.
      </div>
    </>
  );
}
