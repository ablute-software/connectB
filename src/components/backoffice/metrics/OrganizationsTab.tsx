'use client';
// SherlockDeal_Metricas_BackOffice_V1, Section 12. "Para uma equipa
// pequena, é a página que mais trabalho poupa por dia." Section 12.4
// (Private Detective requests) isn't built — that plan tier doesn't exist
// anywhere in code yet (confirmed via the Fase A survey), so there's no
// request form generating data to list.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';

interface ActionListRow { orgId: string; orgName: string; detail: string }
interface StartupOrgRow {
  orgId: string; name: string; plan: string; hasSubscription: boolean; createdAt: string;
  profileReached80At: string | null; roundRaising: boolean | null; pipelineSize: number; contacted: number;
  activityState: string; pendingAccessRequests: number;
}
interface InvestorOrgRow { entityId: string; name: string; verified: boolean; planTier: string | null; seatsLinked: number; startupsAnalyzed: number; activityState: string }
interface OrganizationsData { lists: Record<string, ActionListRow[]>; startups: StartupOrgRow[]; investors: InvestorOrgRow[] }

const LIST_LABELS: Record<string, string> = {
  inactive_30d: 'Inactive >30 days', never_contacted: 'Never contacted an investor',
  incomplete_profile_with_promo: 'Incomplete profile, promo active', near_plan_limit: 'Near or at plan limit',
  payment_failed: 'Payment failed', grant_not_opened: 'Access grant confirmed, Vault Data Room not opened',
};
const ACTIVITY_COLOR: Record<string, string> = {
  highly_active: 'bg-green-50 text-green-700', active: 'bg-cyan-50 text-cyan-700',
  low_activity: 'bg-amber-50 text-amber-700', inactive: 'bg-gray-100 text-gray-500',
};

function ActionList({ title, rows }: { title: string; rows: ActionListRow[] }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <div className="mb-1.5 text-xs font-semibold text-gray-700">{title} ({rows.length})</div>
      {rows.length === 0 ? <p className="text-xs text-gray-400">None right now.</p> : (
        <ul className="space-y-1">
          {rows.slice(0, 8).map((r) => (
            <li key={r.orgId} className="flex items-center justify-between text-xs">
              <span className="font-medium text-gray-800">{r.orgName}</span>
              <span className="text-gray-400">{r.detail}</span>
            </li>
          ))}
          {rows.length > 8 && <li className="text-[11px] text-gray-400">+{rows.length - 8} more — export CSV for the full list.</li>}
        </ul>
      )}
    </div>
  );
}

export function OrganizationsTab() {
  const [data, setData] = useState<OrganizationsData | null>(null);
  const [err, setErr] = useState('');
  const [view, setView] = useState<'startups' | 'investors'>('startups');

  useEffect(() => {
    fetch('/api/backoffice/metrics/organizations').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setData(body); setErr('');
    }).catch(() => setErr('Failed to load.'));
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-5">
      <Card title="Action lists">
        <div className="grid gap-3 md:grid-cols-2">
          {Object.entries(LIST_LABELS).map(([key, label]) => <ActionList key={key} title={label} rows={data.lists[key] ?? []} />)}
        </div>
      </Card>

      <Card title="Organizations"
        right={
          <div className="flex gap-1 rounded-full border border-gray-200 bg-white p-0.5 text-xs">
            {(['startups', 'investors'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`rounded-full px-3 py-1 font-medium ${view === v ? 'bg-[#0E7490] text-white' : 'text-gray-500'}`}>
                {v === 'startups' ? 'Startups' : 'Investors'}
              </button>
            ))}
          </div>
        }>
        {view === 'startups' ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="py-1.5">Startup</th><th>Plan</th><th>Registered</th><th>Profile 80%</th><th>Raising</th><th>Pipeline</th><th>Contacted</th><th>Activity</th>
                </tr>
              </thead>
              <tbody>
                {data.startups.map((o) => (
                  <tr key={o.orgId} className="border-t border-gray-50">
                    <td className="py-1.5 font-medium">{o.name}</td>
                    <td className="text-gray-500">{o.plan}{o.hasSubscription && ' 💳'}</td>
                    <td className="text-gray-500">{o.createdAt.slice(0, 10)}</td>
                    <td className="text-gray-500">{o.profileReached80At ? o.profileReached80At.slice(0, 10) : '—'}</td>
                    <td className="text-gray-500">{o.roundRaising == null ? '—' : o.roundRaising ? 'Yes' : 'No'}</td>
                    <td>{o.pipelineSize}</td><td>{o.contacted}</td>
                    <td><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ACTIVITY_COLOR[o.activityState]}`}>{o.activityState.replace('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="py-1.5">Investor</th><th>MatchDeal tier</th><th>Seats linked</th><th>Startups analyzed</th><th>Activity</th>
                </tr>
              </thead>
              <tbody>
                {data.investors.map((o) => (
                  <tr key={o.entityId} className="border-t border-gray-50">
                    <td className="py-1.5 font-medium">{o.name}</td>
                    <td className="text-gray-500">{o.planTier ?? '—'}</td>
                    <td>{o.seatsLinked}</td><td>{o.startupsAnalyzed}</td>
                    <td><span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ACTIVITY_COLOR[o.activityState]}`}>{o.activityState.replace('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-gray-400">
          Seats/qualified-opportunities/Vault Data Room/DD-access LIMIT usage isn&apos;t shown — investor plan tiers aren&apos;t wired to
          enforced counters yet (matchdeal_tier_limits governs swipe/like caps only). Manage individual benefits from{' '}
          <Link href="/backoffice/catalog" className="text-[#0E7490] hover:underline">Catalog → Assist</Link>.
        </p>
      </Card>
    </div>
  );
}
