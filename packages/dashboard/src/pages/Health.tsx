import { PageHeader } from '../components/PageHeader.js';

/** Health — uptime / MTBF / per-check status (placeholder). */
export function Health() {
  return (
    <>
      <PageHeader title="Health" subtitle="System uptime, MTBF, and per-check status." />
      <div className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500">
        Real-time charts populate when the HealthDaemon's event stream is exposed over WebSocket.
        Use <code>hipp0 doctor</code> for a one-shot report.
      </div>
    </>
  );
}
