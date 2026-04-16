import { PageHeader } from '../components/PageHeader.js';

/** Home — dashboard overview. Placeholder until runtime data is wired. */
export function Home() {
  const stats = [
    { label: 'Active agents', value: '—' },
    { label: 'Decisions', value: '—' },
    { label: 'Skills', value: '—' },
    { label: 'Daily spend', value: '$—' },
  ];
  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Realtime counts will populate from the runtime once the API is wired."
      />
      <dl className="grid grid-cols-4 gap-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-slate-200 bg-slate-50 p-4"
          >
            <dt className="text-xs uppercase tracking-wide text-slate-500">{s.label}</dt>
            <dd className="mt-2 text-2xl font-semibold text-slate-900">{s.value}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
