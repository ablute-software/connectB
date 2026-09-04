'use client';
// Prompt 544 Part E — the back-office answer to "who is waiting".
//
// Nuno's words were "aos poucos no backoffice vamos aumentando essa lista".
// This is what turns that into a queue with an order: per active founder org,
// how many matched investors they have, how many they can actually approach,
// and how many have a hook written. The org at the top is the one the next
// enrichment run should be aimed at.
//
// Prompt 560 §A — "Stuck" is the new first column, and it is deliberately the
// first thing read. Until now this card counted only UNDELIVERED candidates,
// so a founder with 8 delivered-but-unusable rows and a healthy candidate
// list looked perfectly well served. Measured the day this shipped: Estojo 8
// of 13 delivered rows below the floor, "New company" 5 of 10. Those are
// promises already made; the candidate columns are promises not yet made.
// Showing one number for both is what let the worse half hide.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface SupplyRow {
  orgId: string; orgName: string;
  stuck: number; candidates: number; readyToApproach: number; withHook: number;
}

export function OutreachSupplyCard() {
  const [rows, setRows] = useState<SupplyRow[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/catalog/outreach-supply')
      .then((r) => r.json())
      .then((b) => (b.ok ? setRows(b.rows) : setErr(b.error ?? 'Could not load supply.')))
      .catch((e) => setErr((e as Error).message));
  }, []);

  return (
    <Card title="Outreach-ready supply">
      <p className="mb-2 text-xs text-gray-400">
        <span className="font-medium text-gray-500">Stuck</span> — already delivered to this founder and
        below the floor: visible in their pipeline, with nobody to write to. The rest is their top 20
        undelivered matches (fit ≥ 55, at least one reachable person). Most stuck first — finishing those
        pays off before offering anyone new.
      </p>
      {err && <p className="text-xs text-[#B00000]">{err}</p>}
      {!rows && !err && <p className="text-sm text-gray-400">Loading…</p>}
      {rows?.length === 0 && (
        <p className="text-sm text-gray-400">
          No active founder org has stuck deliveries or undelivered matches right now.
        </p>
      )}
      {!!rows?.length && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="py-1 font-medium">Startup</th>
                <th className="py-1 text-right font-medium">Stuck</th>
                <th className="py-1 text-right font-medium">Candidates</th>
                <th className="py-1 text-right font-medium">Can approach</th>
                <th className="py-1 text-right font-medium">With a hook</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => (
                <tr key={r.orgId}>
                  <td className="py-1.5 font-medium text-gray-800">{r.orgName}</td>
                  {/* Red when non-zero — the inverse of every other column
                      here, because this one counts a promise already broken
                      rather than an opportunity not yet taken. */}
                  <td className={`py-1.5 text-right ${r.stuck > 0 ? 'font-semibold text-[#B00000]' : 'text-gray-300'}`}>
                    {r.stuck}
                  </td>
                  <td className="py-1.5 text-right text-gray-500">{r.candidates}</td>
                  {/* Greyed at zero rather than hidden: an org that can approach
                      nobody is the single most important row on this card. */}
                  <td className={`py-1.5 text-right ${r.readyToApproach === 0 ? 'font-semibold text-[#B00000]' : 'text-gray-700'}`}>
                    {r.readyToApproach}
                  </td>
                  <td className={`py-1.5 text-right ${r.withHook === 0 ? 'text-gray-300' : 'text-gray-700'}`}>
                    {r.withHook}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
