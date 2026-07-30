'use client';
// Shared funnel renderer — Sections 8.1 and 9.1 both ask for the same
// shape (step, count, conversion %, dropout, median time to step).
export interface FunnelStep { key: string; label: string; count: number }
export interface FunnelResult { steps: FunnelStep[]; conversionPct: number[]; medianDaysToStep: (number | null)[] }

export function FunnelView({ funnel }: { funnel: FunnelResult }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
            <th className="py-1.5">Step</th><th>Count</th><th>% of top</th><th>Dropout</th><th>Median days to reach</th>
          </tr>
        </thead>
        <tbody>
          {funnel.steps.map((s, i) => {
            const prev = i > 0 ? funnel.steps[i - 1].count : s.count;
            const dropout = i > 0 && prev > 0 ? Math.round(((prev - s.count) / prev) * 100) : 0;
            return (
              <tr key={s.key} className="border-t border-gray-50">
                <td className="py-2 font-medium">{s.label}</td>
                <td className="tabular-nums">{s.count}</td>
                <td className="tabular-nums text-gray-500">{funnel.conversionPct[i]}%</td>
                <td className="tabular-nums text-[#B00000]">{i > 0 ? `-${dropout}%` : '—'}</td>
                <td className="tabular-nums text-gray-500">{funnel.medianDaysToStep[i] ?? '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
