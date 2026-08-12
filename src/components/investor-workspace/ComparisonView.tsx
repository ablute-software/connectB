'use client';
// Investor Workspace Tools (prompt 62.5) — side-by-side comparison. Pure
// client-side view over cards the Pipeline already fetched — no schema, no
// extra API call of its OWN (the enrichment fields below are fetched by
// PipelinePanel.tsx before it passes cards down here — see that file's own
// comment on why that fetch is lazy, only-when-comparing).
//
// Prompt 169 §A — enrichment rows added: Scorecard (this investor's own
// weighted average) and Berkus estimate (sum of their 5 factors). Both are
// per-investor private judgment, nothing new computed or inferred here —
// this just surfaces numbers that already existed elsewhere in the app on
// one row each.
//
// Prompt 174 — a TAM/SAM/SOM row briefly existed here too (same commit as
// the above) but Prompt 169b had already cancelled that before this landed:
// TAM/SAM/SOM has no reliable source today, Nuno's decision (repeated
// twice) is not to surface it anywhere in the product, comparison included.
// Reverted — do not re-add without an explicit new go-ahead.
interface Card {
  orgId: string; name: string; oneLiner: string | null; sectors: string[]; stage: string | null;
  roundTargetEur: number | null; roundValuationEur: number | null; matchScore: number; matchReasons: string[];
  /** This investor's own weighted scorecard average (0-10) for this org — undefined/null if never scored. */
  scorecardAvg?: number | null;
  /** Sum of this investor's own 5 Berkus factors for this org — undefined/null if never estimated
   *  (never 0, which would be indistinguishable from "estimated at zero"). */
  berkusTotal?: number | null;
}

const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };

function fmtEur(n: number | null | undefined) {
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
  { label: 'Scorecard (yours)', render: (c) => (c.scorecardAvg != null ? `${c.scorecardAvg}/10` : '—') },
  { label: 'Berkus estimate (yours)', render: (c) => (c.berkusTotal != null ? fmtEur(c.berkusTotal) : '—') },
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
