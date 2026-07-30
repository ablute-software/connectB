'use client';
// Investor Workspace Tools (prompt 62.5) — side-by-side comparison. Pure
// client-side view over cards the Pipeline already fetched — no schema, no
// extra API call.
interface Card {
  orgId: string; name: string; oneLiner: string | null; sectors: string[]; stage: string | null;
  roundTargetEur: number | null; roundValuationEur: number | null; matchScore: number; matchReasons: string[];
}

const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };

function fmtEur(n: number | null) {
  return n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}

const ROWS: { label: string; render: (c: Card) => string }[] = [
  { label: 'One-liner', render: (c) => c.oneLiner ?? '—' },
  { label: 'Stage', render: (c) => (c.stage ? STAGE_LABELS[c.stage] ?? c.stage : '—') },
  { label: 'Sectors', render: (c) => (c.sectors.length ? c.sectors.join(', ') : '—') },
  { label: 'Raising', render: (c) => fmtEur(c.roundTargetEur) },
  { label: 'Valuation', render: (c) => fmtEur(c.roundValuationEur) },
  { label: 'Match score', render: (c) => `${c.matchScore}%` },
  { label: 'Match reasons', render: (c) => (c.matchReasons.length ? c.matchReasons.join(', ') : '—') },
];

export function ComparisonView({ cards, onClose }: { cards: Card[]; onClose: () => void }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Comparing {cards.length} startups</h2>
        <button onClick={onClose} className="text-xs text-gray-400 hover:underline">Close</button>
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="w-32" />
              {cards.map((c) => <th key={c.orgId} className="px-2 pb-2 text-left font-semibold text-gray-900">{c.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} className="border-t border-gray-100">
                <td className="py-1.5 pr-2 text-xs font-medium text-gray-500">{row.label}</td>
                {cards.map((c) => <td key={c.orgId} className="py-1.5 px-2 text-gray-700">{row.render(c)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
