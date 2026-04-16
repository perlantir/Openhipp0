import { PageHeader } from '../components/PageHeader.js';

/** Costs — LLM usage + daily / monthly spend (placeholder). */
export function Costs() {
  return (
    <>
      <PageHeader title="Costs" subtitle="LLM usage and spend per provider / model." />
      <div className="rounded border border-dashed border-slate-300 p-6 text-sm text-slate-500">
        Costs will aggregate from the <code>llm_usage</code> table. Budgets are enforced by
        <code className="mx-1">LLMClient.chat</code>.
      </div>
    </>
  );
}
