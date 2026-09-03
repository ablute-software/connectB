'use client';
// Prompt 544 Part E — the back-office answer to "who is waiting".
//
// Nuno's words were "aos poucos no backoffice vamos aumentando essa lista".
// This is what turns that into a queue with an order: per active founder org,
// how many matched investors they have, how many they can actually approach,
// and how many have a hook written. The org at the top is the one the next
// enrichment run should be aimed at.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface SupplyRow {
  orgId: string; orgName: string; matches: number; readyToApproach: number; withHook: number;
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
        Per active founder org, out of their top 20 matches (fit ≥ 55, at least one reachable person).
        Worst-served first — that is where the next enrichment run pays off most.
      </p>
      {err && <p className="text-xs text-[#B00000]">{err}</p>}
      {!rows && !err && <p className="text-sm text-gray-400">Loading…</p>}
      {rows?.length === 0 && (
        <p className="text-sm text-gray-400">
          No active founder org has undelivered matches above the floor right now.
        </p>
      )}
      {!!rows?.length && (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
              <th className="py-1 font-medium">Startup</th>
              <th className="py-1 text-right font-medium">Matches</th>
              <th className="py-1 text-right font-medium">Can approach</th>
              <th className="py-1 text-right font-medium">With a hook</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.orgId}>
                <td className="py-1.5 font-medium text-gray-800">{r.orgName}</td>
                <td className="py-1.5 text-right text-gray-500">{r.matches}</td>
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
      )}
    </Card>
  );
}
