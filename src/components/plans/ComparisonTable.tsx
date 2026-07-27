'use client';
// Full feature matrix — rows are the union of every plan's bullets (in
// first-appearance order across the given plans, so cheaper-tier features
// lead), columns are plans, cells are ✓/—. Entirely derived from
// PlanCardData.bullets — no separate feature list to keep in sync.
import type { PlanCardData } from './types';

export function ComparisonTable({ plans }: { plans: PlanCardData[] }) {
  const rows: string[] = [];
  const seen = new Set<string>();
  for (const p of plans) {
    for (const b of p.bullets) {
      if (!seen.has(b)) { seen.add(b); rows.push(b); }
    }
  }

  return (
    <div className="overflow-x-auto rounded-2xl border border-gray-100">
      <table className="w-full min-w-[520px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500">Feature</th>
            {plans.map((p) => (
              <th key={p.id} className="px-4 py-2.5 text-center text-xs font-semibold text-gray-700">{p.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((feature, i) => (
            <tr key={feature} className={i % 2 === 1 ? 'bg-gray-50/50' : undefined}>
              <td className="px-4 py-2 text-xs text-gray-600">{feature}</td>
              {plans.map((p) => (
                <td key={p.id} className="px-4 py-2 text-center">
                  {p.bullets.includes(feature)
                    ? <span className="text-[#0E7490]">✓</span>
                    : <span className="text-gray-300">—</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
