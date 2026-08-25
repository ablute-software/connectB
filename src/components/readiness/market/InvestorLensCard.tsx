'use client';
// Prompt 373 §E — "the investor's lens": mechanical rules (never generated
// text) over the founder's own rings/competitors, saying what an investor
// will notice is missing.
import { useEffect, useState } from 'react';
import { marketDataGaps, type MarketGap } from '@/lib/market-data-gaps';

export function InvestorLensCard() {
  const [gaps, setGaps] = useState<MarketGap[] | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/market-data/rings').then((r) => r.json()),
      fetch('/api/market-data/competitors').then((r) => r.json()),
    ]).then(([ringsBody, competitorsBody]) => {
      const rings = (ringsBody.rings ?? []).map((r: { size_method: string | null; size_value_eur: number | null }) => ({
        sizeMethod: r.size_method, sizeValueEur: r.size_value_eur,
      }));
      const competitors = (competitorsBody.competitors ?? []).map((c: { company: { company_type: string | null; last_round_type: string | null } }) => ({
        companyType: c.company.company_type, hasFundingData: !!c.company.last_round_type,
      }));
      setGaps(marketDataGaps(rings, competitors));
    }).catch(() => setGaps([]));
  }, []);

  if (gaps === null) return null;
  if (gaps.length === 0) return <p className="text-xs text-gray-400">Nothing an investor would flag right now, mechanically speaking.</p>;

  return (
    <ul className="space-y-1.5">
      {gaps.map((g) => (
        <li key={g.rule} className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">{g.message}</li>
      ))}
    </ul>
  );
}
