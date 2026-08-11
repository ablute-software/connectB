'use client';
// Investor Workspace Tools (prompt 62.5) — side-by-side comparison. Pure
// client-side view over cards the Pipeline already fetched — no schema, no
// extra API call of its OWN (the enrichment fields below are fetched by
// PipelinePanel.tsx before it passes cards down here — see that file's own
// comment on why that fetch is lazy, only-when-comparing).
//
// Prompt 169 §A — enrichment rows added: Scorecard (this investor's own
// weighted average), Berkus estimate (sum of their 5 factors), and a
// condensed TAM/SAM/SOM line. All three are per-investor private judgment
// or already-disclosed dossier data — nothing new is computed or inferred
// here, this just surfaces numbers that already existed elsewhere in the
// app on one row each.
interface Card {
  orgId: string; name: string; oneLiner: string | null; sectors: string[]; stage: string | null;
  roundTargetEur: number | null; roundValuationEur: number | null; matchScore: number; matchReasons: string[];
  /** This investor's own weighted scorecard average (0-10) for this org — undefined/null if never scored. */
  scorecardAvg?: number | null;
  /** Sum of this investor's own 5 Berkus factors for this org — undefined/null if never estimated
   *  (never 0, which would be indistinguishable from "estimated at zero"). */
  berkusTotal?: number | null;
  tamEur?: number | null;
  samEur?: number | null;
  somEur?: number | null;
}

const STAGE_LABELS: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', series_a: 'Series A', series_b_plus: 'Series B+', growth: 'Growth' };

function fmtEur(n: number | null | undefined) {
  return n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n);
}
// Local, deliberately not lib/format-money.ts's fmtRoundEur (that one's own
// header says it's dedicated to Round Progress specifically) — TAM/SAM/SOM
// are typically 7-8 figure market sizes, so the same "spell out under €1M,
// abbreviate to m/b above it" shape is wanted here too, just kept local
// since this is the only place in this file that needs it.
function fmtEurCompact(n: number | null | undefined) {
  if (n == null) return null;
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `€${Math.round((n / 1_000_000_000) * 10) / 10}b`;
  if (abs >= 1_000_000) return `€${Math.round((n / 1_000_000) * 10) / 10}m`;
  return fmtEur(n);
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
  {
    label: 'TAM / SAM / SOM',
    render: (c) => {
      const parts = [
        c.tamEur != null && `TAM ${fmtEurCompact(c.tamEur)}`,
        c.samEur != null && `SAM ${fmtEurCompact(c.samEur)}`,
        c.somEur != null && `SOM ${fmtEurCompact(c.somEur)}`,
      ].filter((v): v is string => !!v);
      return parts.length ? parts.join(' · ') : '—';
    },
  },
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
