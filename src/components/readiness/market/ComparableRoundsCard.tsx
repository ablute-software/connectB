'use client';
// Prompt 384 §B.3 — "Comparable rounds": the benchmark an investor will ask
// the founder to justify against ("what should I benchmark you against?").
// No new AI, no new query — /api/market-data/competitors already joins each
// tracked competitor to its own known funding rounds (investor_investments,
// the exact same join dossier-fetch.ts's own `rounds` group uses for the
// investor-facing dossier — src/app/portal/startup/[orgId]/page.tsx's
// MarketTab already renders this to the investor). This card is the
// founder-facing mirror: today these rounds only ever reach the investor,
// the founder never sees them laid out together.
import { useEffect, useState } from 'react';

// Prompt 447 §D.4 — reads the server-merged `rounds` (market-rounds-
// merge.ts) instead of deriving it client-side from `competitors`: rounds
// now also include accepted `rounds` research items (445's
// RoundStructured), not just tracked competitors' own known funding
// history. Already sorted and deduped server-side — no client logic left.
interface ComparableRound {
  companyName: string; investorName: string | null; amountEur: number | null; investedAt: string | null;
  roundType: string | null; source: 'competitor_tracked' | 'research';
}

function fmtEur(v: number | null): string | null {
  return v == null ? null : `€${v.toLocaleString()}`;
}

export function ComparableRoundsCard() {
  const [rows, setRows] = useState<ComparableRound[] | null>(null);

  useEffect(() => {
    fetch('/api/market-data/competitors').then((r) => r.json()).then((body) => {
      setRows((body.rounds ?? []) as ComparableRound[]);
    }).catch(() => setRows([]));
  }, []);

  if (rows === null) return <p className="text-sm text-gray-400">Loading…</p>;
  if (rows.length === 0) {
    return (
      <p className="text-xs text-gray-400">
        No sourced rounds yet — they come from the funding history of the competitors you track below. Add competitors
        with known investors and their rounds show up here automatically.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs text-gray-500">Recent rounds from the competitors you track — the benchmark an investor will ask you to justify against.</p>
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 text-left text-[10px] uppercase tracking-wide text-gray-400">
            <tr>
              <th className="px-2.5 py-1.5">Date</th>
              <th className="px-2.5 py-1.5">Company</th>
              <th className="px-2.5 py-1.5">Round</th>
              <th className="px-2.5 py-1.5">Amount</th>
              <th className="px-2.5 py-1.5">Investor</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-500">{r.investedAt ? r.investedAt.slice(0, 7) : '—'}</td>
                <td className="px-2.5 py-1.5 font-medium text-gray-800">{r.companyName}</td>
                <td className="px-2.5 py-1.5 text-gray-600">{r.roundType ?? '—'}</td>
                <td className="whitespace-nowrap px-2.5 py-1.5 text-gray-600">{fmtEur(r.amountEur) ?? '—'}</td>
                <td className="px-2.5 py-1.5 text-gray-500">{r.investorName ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
