import { PageHeader } from '../components/PageHeader.js';

/** Scheduler — cron tasks + webhooks (placeholder). */
export function Scheduler() {
  return (
    <>
      <PageHeader title="Scheduler" subtitle="Heartbeat cron tasks + webhook triggers." />
      <div className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500">
        Configure cron tasks with <code>hipp0 cron add &lt;id&gt; &lt;schedule&gt;</code>.
      </div>
    </>
  );
}
