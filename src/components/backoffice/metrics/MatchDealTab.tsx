'use client';
// Prompt 124 §2 (Block A) — MatchDeal's own metrics, the app floor's 6th
// tab. Every counter here already exists in real tables — this is a screen,
// not new instrumentation. Read-only: no touches to the matching engine.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface MatchDealData {
  swipesPerDay: number; likesLastWeek: number; passesLastWeek: number; activeMatches: number;
  activePairings: { startup: number; investor: number };
  weekStart: string | null;
  usageByTier: Record<string, { profiles: number; shown: number; likes: number; reconsiderations: number }>;
}

const TIER_LABEL: Record<string, string> = { tier_a: 'Tier A (Elementary)', tier_b: 'Tier B (List of Suspects)', tier_c: 'Tier C (Butler)', unknown: 'Unknown tier' };

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
      <div className="text-2xl font-bold text-[#0E7490]">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
}

export function MatchDealTab() {
  const [data, setData] = useState<MatchDealData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/metrics/matchdeal').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error); return; }
      setData(body);
    }).catch(() => setErr('Failed to load.'));
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Swipes / day" value={data.swipesPerDay} hint="last 7 days, daily average" />
        <Stat label="Likes (7d)" value={data.likesLastWeek} />
        <Stat label="Passes (7d)" value={data.passesLastWeek} />
        <Stat label="Active matches" value={data.activeMatches} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active pairings — startup" value={data.activePairings.startup} hint="paired PWA devices" />
        <Stat label="Active pairings — investor" value={data.activePairings.investor} hint="paired PWA devices" />
      </div>

      <Card title={`Usage by tier — week of ${data.weekStart ?? '—'}`}>
        {Object.keys(data.usageByTier).length === 0 ? (
          <p className="text-sm text-gray-400">No weekly activity recorded yet this week.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-1.5">Tier</th><th>Profiles active</th><th>Shown</th><th>Likes</th><th>Reconsiderations</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(data.usageByTier).map(([tier, row]) => (
                <tr key={tier} className="border-t border-gray-50">
                  <td className="py-2 font-medium">{TIER_LABEL[tier] ?? tier}</td>
                  <td className="text-gray-600">{row.profiles}</td>
                  <td className="text-gray-600">{row.shown}</td>
                  <td className="text-gray-600">{row.likes}</td>
                  <td className="text-gray-600">{row.reconsiderations}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
