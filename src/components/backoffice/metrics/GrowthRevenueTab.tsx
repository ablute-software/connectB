'use client';
// SherlockDeal_Metricas_BackOffice_V1, Section 7.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { PeriodPicker, type Period } from './PeriodPicker';
import { MetricDrillDown, type DrillDownSeries } from './MetricDrillDown';

interface GrowthData {
  acquisition: { completedRegistrations: number; bySource: Record<string, number> };
  plans: { free: number; paid: number; byPlan: Record<string, number>; upgrades: number; downgrades: number; cancellations: number };
  revenue: {
    mrr: number; mrrPotential: number; arr: number; arrPotential: number; netNewMrr: number;
    startupRevenue: number; investorRevenue: number; arpa: number; discountsValue: number;
  };
  promo: { totalRedemptions: number; byPartner: Record<string, number>; activationRatePct: number | null };
}

function fmtEur(n: number): string { return `€${Math.round(n).toLocaleString()}`; }

// Prompt 296 §2 — clickable when it names history path(s) (only MRR/ARR
// have history captured today, since those are the fields the daily
// snapshot stores under revenue.* — see metrics-snapshot.ts). Everything
// else here (ARPA, upgrades/downgrades, promo breakdown, …) isn't in the
// snapshot payload yet, so it stays a plain, non-clickable card rather than
// promising a trend chart that would never have anything to show.
function MiniStat({ label, value, onClick }: { label: string; value: string | number; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`rounded-xl border border-gray-100 bg-white p-3 ${onClick ? 'cursor-pointer transition hover:border-[#0E7490] hover:shadow-sm' : ''}`}
    >
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
  const [drillDown, setDrillDown] = useState<{ title: string; series: DrillDownSeries[] } | null>(null);

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
            {/* Prompt 296 §3 — real (effective, post-discount) always primary
                and prominent; potential (list price) always secondary and
                discreet, right next to it — never a single ambiguous number. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-gray-100 bg-white p-3 cursor-pointer transition hover:border-[#0E7490] hover:shadow-sm"
                onClick={() => setDrillDown({
                  title: 'MRR — real vs. potencial',
                  series: [
                    { path: 'revenue.mrr', label: 'Real (efetivo)', color: '#0E7490', formatValue: fmtEur },
                    { path: 'revenue.mrrPotential', label: 'Potencial (preço de tabela)', color: '#CBD5E1', formatValue: fmtEur },
                  ],
                })}>
                <div className="text-lg font-bold text-[#0E7490]">{fmtEur(data.revenue.mrr)}</div>
                <div className="text-[11px] text-gray-400">real · {fmtEur(data.revenue.mrrPotential)} ao preço de tabela</div>
                <div className="mt-0.5 text-[11px] text-gray-500">MRR</div>
              </div>
              <div className="rounded-xl border border-gray-100 bg-white p-3 cursor-pointer transition hover:border-[#0E7490] hover:shadow-sm"
                onClick={() => setDrillDown({
                  title: 'ARR — real vs. potencial (MRR × 12)',
                  series: [
                    { path: 'revenue.mrr', label: 'Real (efetivo) — MRR', color: '#0E7490', formatValue: (v) => fmtEur(v * 12) },
                    { path: 'revenue.mrrPotential', label: 'Potencial (preço de tabela) — MRR', color: '#CBD5E1', formatValue: (v) => fmtEur(v * 12) },
                  ],
                })}>
                <div className="text-lg font-bold text-[#0E7490]">{fmtEur(data.revenue.arr)}</div>
                <div className="text-[11px] text-gray-400">real · {fmtEur(data.revenue.arrPotential)} ao preço de tabela</div>
                <div className="mt-0.5 text-[11px] text-gray-500">ARR</div>
              </div>
              <MiniStat label="Net New MRR" value={`€${data.revenue.netNewMrr.toLocaleString()}`}
                onClick={() => setDrillDown({ title: 'Net New MRR', series: [{ path: 'revenue.netNewMrr', label: 'Net New MRR', color: '#16a34a', formatValue: fmtEur }] })} />
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

      {drillDown && (
        <MetricDrillDown title={drillDown.title} series={drillDown.series} onClose={() => setDrillDown(null)} />
      )}
    </div>
  );
}
