'use client';
// Prompt 340 Block A — investor Dashboard tab. Own-data only: pipeline
// funnel, upcoming round closes among the investor's own pipeline startups,
// their own active follow-on signals, and their own recent activity. See
// investor-dashboard.ts's own header for why each field is safe to show
// (every one of them is already visible to this investor elsewhere).
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';

interface DashboardFunnel { byStatus: { open: number; interested: number; passed: number }; byLevel: Record<'0' | '1' | '2' | '3', number> }
interface DashboardRoundClose { orgId: string; orgName: string; date: string }
interface DashboardFollowOn { orgId: string; orgName: string; expiresAt: string | null }
interface DashboardActivityItem { kind: 'decision' | 'qa_answered'; title: string; orgId: string; at: string }
interface DashboardResponse {
  ok: boolean; linked: boolean; funnel: DashboardFunnel | null;
  roundCloses: DashboardRoundClose[]; followOn: DashboardFollowOn[]; recentActivity: DashboardActivityItem[];
}

const LEVEL_LABEL: Record<string, string> = { '0': 'Discovery', '1': 'Interested', '2': 'Full profile', '3': 'Contact granted' };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function InvestorDashboardPanel() {
  const [data, setData] = useState<DashboardResponse | null>(null);

  useEffect(() => {
    fetch('/api/portal/dashboard').then((r) => r.json()).then(setData).catch(() => setData(null));
  }, []);

  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  if (!data.linked || !data.funnel) {
    return (
      <div className="mx-auto mt-16 max-w-sm rounded-lg border border-gray-200 bg-white p-6 text-center">
        <p className="text-sm text-gray-600">Your Dashboard fills in once your Pipeline is unlocked.</p>
      </div>
    );
  }

  const { funnel, roundCloses, followOn, recentActivity } = data;
  const totalCards = funnel.byStatus.open + funnel.byStatus.interested + funnel.byStatus.passed;

  return (
    <div className="space-y-4" data-tour-id="investor-dashboard-root">
      <h1 className="text-lg font-bold text-gray-900">Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Your pipeline">
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between"><span className="text-gray-600">Open</span><span className="font-semibold text-gray-900">{funnel.byStatus.open}</span></div>
            <div className="flex items-center justify-between"><span className="text-gray-600">Interested</span><span className="font-semibold text-gray-900">{funnel.byStatus.interested}</span></div>
            <div className="flex items-center justify-between"><span className="text-gray-600">Passed</span><span className="font-semibold text-gray-900">{funnel.byStatus.passed}</span></div>
            <div className="mt-1 border-t border-gray-100 pt-1 text-xs text-gray-400">{totalCards} startup{totalCards === 1 ? '' : 's'} total</div>
          </div>
        </Card>

        <Card title="By connection level">
          <div className="space-y-1.5 text-sm">
            {(['0', '1', '2', '3'] as const).map((lvl) => (
              <div key={lvl} className="flex items-center justify-between">
                <span className="text-gray-600">{LEVEL_LABEL[lvl]}</span>
                <span className="font-semibold text-gray-900">{funnel.byLevel[lvl] ?? 0}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Upcoming round closes">
        {roundCloses.length === 0 ? (
          <p className="text-sm text-gray-400">No round-close dates declared yet among your pipeline startups.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {roundCloses.map((r) => (
              <li key={r.orgId} className="flex items-center justify-between">
                <Link href={`/portal/startup/${r.orgId}`} className="text-[#0E7490] hover:underline">{r.orgName}</Link>
                <span className="text-xs text-gray-400">{fmtDate(r.date)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Your active follow-on signals">
        {followOn.length === 0 ? (
          <p className="text-sm text-gray-400">No active follow-on signals — manage these from My Network → Follow-on.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {followOn.map((f) => (
              <li key={f.orgId} className="flex items-center justify-between">
                <Link href={`/portal/startup/${f.orgId}`} className="text-[#0E7490] hover:underline">{f.orgName}</Link>
                <span className="text-xs text-gray-400">{f.expiresAt ? `expires ${fmtDate(f.expiresAt)}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Recent activity">
        {recentActivity.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing recent — decisions you make and answered questions show up here.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {recentActivity.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <Link href={`/portal/startup/${a.orgId}`} className="text-gray-800 hover:underline">{a.title}</Link>
                <span className="shrink-0 text-xs text-gray-400">{fmtDate(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
