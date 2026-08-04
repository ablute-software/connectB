'use client';
// SherlockDeal_Metricas_BackOffice_V1, Section 7.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { PeriodPicker, type Period } from './PeriodPicker';

interface GrowthData {
  acquisition: { completedRegistrations: number; bySource: Record<string, number> };
  plans: { free: number; paid: number; byPlan: Record<string, number>; upgrades: number; downgrades: number; cancellations: number };
  revenue: { mrr: number; arr: number; netNewMrr: number; startupRevenue: number; investorRevenue: number; arpa: number; discountsValue: number };
  promo: { totalRedemptions: number; byPartner: Record<string, number>; activationRatePct: number | null };
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-3">
      <div className="text-lg font-bold text-[#0E7490]">{value}</div>
      <div className="mt-0.5 text-[11px] text-gray-500">{label}</div>
    </div>
  );
}

function Breakdown({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return <p className="text-xs text-gray-400">No data yet.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {entries.map(([k, v]) => (
        <li key={k} className="flex items-center justify-between border-b border-gray-50 py-1 last:border-0">
          <span className="text-gray-600">{k}</span><span className="font-medium text-gray-900">{v}</span>
        </li>
      ))}
    </ul>
  );
}

export function GrowthRevenueTab() {
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<GrowthData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`/api/backoffice/metrics/growth?period=${period}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setData(body); setErr('');
    }).catch(() => setErr('Failed to load.'));
  }, [period]);

  return (
    <div className="space-y-5">
      <PeriodPicker period={period} onChange={setPeriod} />
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {!data ? <p className="text-sm text-gray-400">Loading…</p> : (
        <>
          <Card title="Acquisition">
            <p className="mb-2 text-xs text-gray-400">
              &quot;Registos iniciados&quot; and completion rate aren&apos;t measurable yet — Supabase Auth doesn&apos;t expose an
              abandoned-signup state this schema captures. Acquisition source is now captured at signup (Prompt 124 C1)
              — shows &quot;Unknown&quot; until migration 0122 is applied, and only for signups from that point on.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="Completed registrations" value={data.acquisition.completedRegistrations} />
            </div>
            <div className="mt-3"><Breakdown data={data.acquisition.bySource} /></div>
          </Card>

          <Card title="Plans & subscriptions">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <MiniStat label="Free orgs" value={data.plans.free} />
              <MiniStat label="Paid orgs" value={data.plans.paid} />
              <MiniStat label="Upgrades" value={data.plans.upgrades} />
              <MiniStat label="Downgrades" value={data.plans.downgrades} />
              <MiniStat label="Cancellations" value={data.plans.cancellations} />
            </div>
            <div className="mt-3"><Breakdown data={data.plans.byPlan} /></div>
          </Card>

          <Card title="Revenue">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <MiniStat label="MRR" value={`€${data.revenue.mrr.toLocaleString()}`} />
              <MiniStat label="ARR" value={`€${data.revenue.arr.toLocaleString()}`} />
              <MiniStat label="Net New MRR" value={`€${data.revenue.netNewMrr.toLocaleString()}`} />
              <MiniStat label="ARPA" value={`€${data.revenue.arpa.toLocaleString()}`} />
              <MiniStat label="Startup revenue" value={`€${data.revenue.startupRevenue.toLocaleString()}`} />
              <MiniStat label="Investor revenue" value={`€${data.revenue.investorRevenue.toLocaleString()}`} />
              <MiniStat label="Active discounts value" value={`€${data.revenue.discountsValue.toLocaleString()}/mo`} />
            </div>
            {data.revenue.investorRevenue === 0 && (
              <p className="mt-2 text-[11px] text-gray-400">Investor-side plans have no live billing wiring yet — €0 until that exists, not an estimate.</p>
            )}
          </Card>

          <Card title="Promo codes & referrals">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <MiniStat label="Redemptions" value={data.promo.totalRedemptions} />
              <MiniStat label="Reach 80% after redeeming" value={data.promo.activationRatePct != null ? `${data.promo.activationRatePct}%` : '—'} />
            </div>
            <div className="mt-3"><Breakdown data={data.promo.byPartner} /></div>
          </Card>
        </>
      )}
    </div>
  );
}
