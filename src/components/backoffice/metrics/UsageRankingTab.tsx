'use client';
// Prompt 296 §4 — general usage ranking (by org and by person), CRM context
// only. Lives in its own tab in the current shell for now — Prompt 294's
// backoffice redesign (branch backoffice-redesign) may relocate this once
// that lands, per that prompt's own sequencing note.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface OrgRankRow { orgId: string; orgName: string; activeMinutes: number; standbyMinutes: number; accessesPerDay: number; sessionCount: number }
interface PersonRankRow { userId: string; email: string; activeMinutes: number; standbyMinutes: number; accessesPerDay: number; sessionCount: number }
interface RankingData { windowDays: number; byOrg: OrgRankRow[]; byPerson: PersonRankRow[] }

function RankTable<T extends { activeMinutes: number; standbyMinutes: number; accessesPerDay: number; sessionCount: number }>({
  rows, nameOf, nameHeader,
}: { rows: T[]; nameOf: (r: T) => string; nameHeader: string }) {
  if (rows.length === 0) return <p className="text-sm text-gray-400">No usage recorded in this window yet.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">
            <th className="pb-2">{nameHeader}</th>
            <th className="pb-2">Active</th>
            <th className="pb-2">Standby</th>
            <th className="pb-2">Accesses/day</th>
            <th className="pb-2">Sessions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-gray-50">
              <td className="py-2 font-semibold text-gray-900">{nameOf(r)}</td>
              <td className="py-2 text-gray-700">{r.activeMinutes}min</td>
              <td className="py-2 text-gray-400">{r.standbyMinutes}min</td>
              <td className="py-2 text-gray-700">{r.accessesPerDay}</td>
              <td className="py-2 text-gray-400">{r.sessionCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function UsageRankingTab() {
  const [data, setData] = useState<RankingData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/usage-ranking').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'Failed to load.'); return; }
      setData(body);
    }).catch(() => setErr('Failed to load.'));
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-5">
      <p className="text-xs text-gray-400">
        Active vs. standby minutes are never summed into one number — active is real interaction, standby is a visible-but-idle tab.
        Window: last {data.windowDays} days. CRM context only (founder workspace) — MatchDeal has its own usage ranking.
      </p>
      <Card title="By organization">
        <RankTable rows={data.byOrg} nameOf={(r) => r.orgName} nameHeader="Organization" />
      </Card>
      <Card title="By person">
        <RankTable rows={data.byPerson} nameOf={(r) => r.email} nameHeader="Person" />
      </Card>
    </div>
  );
}
