'use client';
// SherlockDeal_Metricas_BackOffice_V1, Section 4 — the reduced V1 period
// set, shared by every tab so "hoje / 7 dias / 30 dias / mês atual / mês
// anterior" means the exact same window everywhere (13.2's centralization
// rule applies to filters too, not just formulas).
export type Period = 'today' | '7d' | '30d' | 'this_month' | 'last_month';

export const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_month', label: 'Last month' },
];

export function PeriodPicker({ period, onChange }: { period: Period; onChange: (p: Period) => void }) {
  return (
    <div className="flex w-fit items-center gap-1 rounded-full border border-gray-200 bg-white p-0.5 text-xs">
      {PERIODS.map((p) => (
        <button key={p.key} onClick={() => onChange(p.key)}
          className={`rounded-full px-3 py-1 font-medium transition ${period === p.key ? 'bg-[#0E7490] text-white shadow-sm' : 'text-gray-500 hover:bg-gray-50'}`}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
