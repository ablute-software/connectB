'use client';
// Prompt 875 — Backoffice Marketing "Overview" tab. Four data sections plus
// a revenue/paying-users chart, all sourced from GET
// /api/backoffice/marketing-overview — no hardcoded or illustrative figures.
import { useEffect, useState } from 'react';
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';

function fmtEur(n: number): string {
  const sign = n < 0 ? '-' : '';
  return `${sign}€${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '—';
}

interface PromoByPlanRow { plan: string; planLabel: string; created: number; redeemed: number }
interface ByCategoryRow { label: string; offered: number; redeemed: number }
interface NetCostOrgRow {
  org_id: string; org_name: string; redeemed_at: string; benefit_ends_at: string | null;
  ai_cost_eur: number; amount_paid_eur: number; net_eur: number;
}
interface RevenueMonthRow { month: string; revenue_eur: number; paying_org_count: number }
interface OverviewData {
  promoByPlan: PromoByPlanRow[];
  byCategory: ByCategoryRow[];
  netCost: { byOrg: NetCostOrgRow[]; totalEur: number };
  convertedAfterPromo: number;
  convertedByPlanFieldOnly: number;
  revenueByMonth: RevenueMonthRow[];
}

function InfoDot({ title }: { title: string }) {
  return (
    <span
      title={title}
      className="ml-1 inline-flex h-3.5 w-3.5 cursor-help items-center justify-center rounded-full bg-gray-200 text-[9px] font-bold text-gray-500"
    >
      i
    </span>
  );
}

export default function MarketingOverviewPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/marketing-overview').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'Could not load the marketing overview.'); return; }
      setData(body);
    }).catch(() => setErr('Could not load the marketing overview.'));
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Marketing Overview</h1>
        <p className="mt-0.5 text-sm text-gray-500">
          The promo/outreach program end to end: what codes went out, what came back, and what it actually cost.
        </p>
      </div>

      {/* §1 — promo codes created / redeemed, by plan */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center text-sm font-bold text-gray-900">
          Promo codes — created / redeemed, by plan
          <InfoDot title="A code can target more than one plan at once, so 'Created' counts a multi-plan code once under EACH plan it applies to (a multi-plan code is double-counted across rows). A redemption has no stored plan of its own, so 'Redeemed' is attributed to the redeeming org's CURRENT plan, which is not necessarily the plan the code targeted." />
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 text-left text-[10.5px] font-bold uppercase tracking-wide text-gray-400">
              <th className="py-1.5">Plan</th>
              <th className="py-1.5 text-right">Created</th>
              <th className="py-1.5 text-right">Redeemed</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {data.promoByPlan.map((r) => (
              <tr key={r.plan}>
                <td className="py-1.5 font-medium text-gray-800">{r.planLabel}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-700">{r.created}</td>
                <td className="py-1.5 text-right tabular-nums text-gray-700">{r.redeemed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* §2 — offered / redeemed by category */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-bold text-gray-900">Outreach — offered / redeemed, by category</div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {data.byCategory.map((c) => (
            <div key={c.label} className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
              <div className="text-xs font-semibold text-gray-500">{c.label}</div>
              <div className="mt-1 text-sm text-gray-800">
                Offered: <span className="font-bold">{c.offered}</span> · Redeemed: <span className="font-bold">{c.redeemed}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* §3 — net cost of the promo program */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-1 flex items-center text-sm font-bold text-gray-900">
          Net cost of the promo program
          <InfoDot title="AI spend only (ai_call_log), not full platform infrastructure cost (hosting, Supabase, etc.) — a fuller cost basis is a separate conversation. A negative number means the program is net-costing the platform, the expected/normal case for an early-stage discount program." />
        </div>
        <div className={`mt-1 text-2xl font-extrabold ${data.netCost.totalEur < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
          {fmtEur(data.netCost.totalEur)}
        </div>
        <p className="mt-0.5 text-xs text-gray-400">AI cost only. Summed across every org that has ever redeemed a promo code.</p>

        {data.netCost.byOrg.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">No promo redemptions yet.</p>
        ) : (
          <table className="mt-3 w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-left font-bold uppercase tracking-wide text-gray-400">
                <th className="py-1.5">Org</th>
                <th className="py-1.5">Redeemed</th>
                <th className="py-1.5">Benefit ends</th>
                <th className="py-1.5 text-right">AI cost</th>
                <th className="py-1.5 text-right">Paid</th>
                <th className="py-1.5 text-right">Net</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {data.netCost.byOrg.map((r) => (
                <tr key={r.org_id}>
                  <td className="py-1.5 font-medium text-gray-800">{r.org_name}</td>
                  <td className="py-1.5 text-gray-600">{fmtDate(r.redeemed_at)}</td>
                  <td className="py-1.5 text-gray-600">{r.benefit_ends_at ? fmtDate(r.benefit_ends_at) : 'no expiry'}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-700">{fmtEur(r.ai_cost_eur)}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-700">{fmtEur(r.amount_paid_eur)}</td>
                  <td className={`py-1.5 text-right tabular-nums font-semibold ${r.net_eur < 0 ? 'text-amber-700' : 'text-emerald-700'}`}>{fmtEur(r.net_eur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* §4 — converted after promo ended */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Converted after promo ended</div>
        <div className="mt-2 text-2xl font-extrabold text-gray-900">{data.convertedAfterPromo}</div>
        <p className="mt-1 text-xs text-gray-400">
          Redeeming orgs whose promo has ended and who now have a real paid invoice dated after it.
          {data.convertedByPlanFieldOnly > 0 && (
            <> {data.convertedByPlanFieldOnly} more {data.convertedByPlanFieldOnly === 1 ? 'org is' : 'orgs are'} on a paying plan
              with its promo ended but no paid invoice dated after it yet (a very recent conversion whose first invoice
              hasn&apos;t fired, or a stale plan field) — not counted above.</>
          )}
        </p>
      </div>

      {/* §5 — revenue and paying users over time */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-bold text-gray-900">Revenue &amp; paying users over time</div>
        {data.revenueByMonth.length === 0 ? (
          <p className="text-sm text-gray-400">
            No paid invoices recorded yet — the invoice mirror this chart reads from only started capturing data
            recently, so history here starts from whenever it shipped, not further back.
          </p>
        ) : (
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={data.revenueByMonth} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="#9CA3AF" />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} stroke="#9CA3AF"
                  tickFormatter={(v: number) => `€${v}`} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} stroke="#9CA3AF" allowDecimals={false} />
                <Tooltip formatter={(value, name) => (name === 'Revenue' ? [fmtEur(Number(value)), name] : [value, name])}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar yAxisId="left" dataKey="revenue_eur" name="Revenue" fill="#0E7490" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Line yAxisId="right" type="monotone" dataKey="paying_org_count" name="Paying orgs" stroke="#DB2777" strokeWidth={2} dot isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <p className="mt-2 text-xs text-gray-400">
          Revenue = paid invoices (billing_invoices). Paying orgs = distinct orgs with at least one paid invoice that month.
        </p>
      </div>
    </div>
  );
}
