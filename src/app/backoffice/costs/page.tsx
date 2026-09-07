'use client';
// Prompt 293 §2 — "AI Costs" backoffice tab. Layout follows the published
// mockup (https://claude.ai/code/artifact/44abb39a-04d4-478e-9368-0e0d82f8fb6b,
// "Costs.dc.html" artboard) closely: 3 KPI cards with a colored top
// accent, two charts side by side (cost-by-mechanism bars, avg-cost-per-
// startup-over-time bars), and a ranking table with a proportional bar
// embedded in the value cell. Real numbers only — every figure here comes
// from GET /api/backoffice/ai-costs (ai_call_log, migration 0202), the
// mockup's own numbers were explicitly illustrative placeholders.
import { useEffect, useState } from 'react';

function fmtEur(n: number): string {
  return `€${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtEurCompact(n: number): string {
  return `€${n.toLocaleString('en-US', { maximumFractionDigits: n < 10 ? 2 : 0 })}`;
}

interface CostsData {
  totalSpend30dEur: number; totalSpendPrior30dEur: number;
  activeStartupCount: number; avgCostPerActiveStartupEur: number;
  mostExpensiveMechanism: { name: string; amountEur: number; pctOfTotal: number } | null;
  mechanisms: { name: string; amountEur: number; pct: number }[];
  trend: { month: string; avgCostEur: number }[];
  ranking: { rank: number; orgId: string; orgName: string; amountEur: number; pctOfTotal: number; topMechanism: string; barPct: number; requestCount: number; tokensTotal: number }[];
  sharedCatalog30dEur: number;
}

// Same 6-color rotation as elsewhere in the backoffice (deterministic by
// index, not by name) — just enough variety to tell mechanism bars apart.
const BAR_COLORS = ['#0E7490', '#22D3EE', '#7c3aed', '#2563eb', '#d97706', '#db2777', '#16a34a', '#64748b'];

export default function AiCostsPage() {
  const [data, setData] = useState<CostsData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/ai-costs').then((r) => r.json()).then((body) => {
      if (!body.ok) { setErr(body.error ?? 'not available'); return; }
      setData(body);
    }).catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  const deltaPct = data.totalSpendPrior30dEur > 0
    ? ((data.totalSpend30dEur - data.totalSpendPrior30dEur) / data.totalSpendPrior30dEur) * 100
    : null;
  const maxTrend = Math.max(1, ...data.trend.map((t) => t.avgCostEur));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-gray-900">AI &amp; API Costs</h1>
        <p className="mt-0.5 text-sm text-gray-500">What the platform&apos;s AI tools are actually costing, by mechanism and by startup — last 30 days.</p>
      </div>

      {/* KPI row — 3 cards, each with a colored top accent (border-t-4),
          same visual language as the mockup's border-top:3px cards. */}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-gray-100 border-t-4 border-t-[#0E7490] bg-white p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Total spend — last 30 days</div>
          <div className="mt-2 text-2xl font-extrabold text-gray-900">{fmtEur(data.totalSpend30dEur)}</div>
          {deltaPct !== null && (
            <div className={`mt-1 text-xs font-semibold ${deltaPct >= 0 ? 'text-amber-600' : 'text-emerald-600'}`}>
              {deltaPct >= 0 ? '↑' : '↓'} {Math.abs(deltaPct).toFixed(0)}% vs. prior 30 days
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-gray-100 border-t-4 border-t-cyan-400 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Avg. cost per active startup</div>
          <div className="mt-2 text-2xl font-extrabold text-gray-900">{fmtEur(data.avgCostPerActiveStartupEur)}</div>
          <div className="mt-1 text-xs font-semibold text-emerald-600">across {data.activeStartupCount} active org{data.activeStartupCount === 1 ? '' : 's'}</div>
        </div>
        <div className="rounded-2xl border border-gray-100 border-t-4 border-t-violet-600 bg-white p-4 shadow-sm">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Most expensive mechanism</div>
          <div className="mt-2 text-lg font-extrabold text-gray-900">{data.mostExpensiveMechanism?.name ?? '—'}</div>
          {data.mostExpensiveMechanism && (
            <div className="mt-1 text-xs font-semibold text-gray-400">{data.mostExpensiveMechanism.pctOfTotal.toFixed(0)}% of total spend</div>
          )}
        </div>
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-bold text-gray-900">Cost by tool / mechanism — 30d</div>
          {data.mechanisms.length === 0 ? <p className="text-sm text-gray-400">No AI calls logged yet.</p> : (
            <div className="space-y-2.5">
              {data.mechanisms.map((m, i) => (
                <div key={m.name}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="font-medium text-gray-700">{m.name}</span>
                    <span className="font-bold text-gray-900">{fmtEurCompact(m.amountEur)}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-gray-100">
                    <div className="h-full rounded" style={{ width: `${m.pct}%`, background: BAR_COLORS[i % BAR_COLORS.length] }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
          <div className="mb-3 text-sm font-bold text-gray-900">Avg. cost per startup — last 6 months</div>
          <div className="flex h-[150px] items-end gap-3 px-1">
            {data.trend.map((t) => (
              <div key={t.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <span className="text-[10px] font-bold text-gray-900">{fmtEurCompact(t.avgCostEur)}</span>
                <div className="w-full max-w-[34px] rounded-t bg-[#0E7490]" style={{ height: `${Math.max(4, (t.avgCostEur / maxTrend) * 100)}%` }} />
                <span className="text-[10px] font-semibold text-gray-400">{t.month}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Ranking table */}
      <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
        <div className="mb-3 text-sm font-bold text-gray-900">Ranking — spend by startup, last 30 days</div>
        {data.ranking.length === 0 ? <p className="text-sm text-gray-400">No per-org spend logged yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left text-[11px] font-bold uppercase tracking-wide text-gray-400">
                  <th className="w-10 pb-2">#</th>
                  <th className="pb-2">Startup</th>
                  <th className="w-56 pb-2">Total spend</th>
                  <th className="w-20 pb-2">% of total</th>
                  <th className="w-20 pb-2">Requests</th>
                  <th className="w-24 pb-2">Tokens</th>
                  <th className="pb-2">Top mechanism</th>
                </tr>
              </thead>
              <tbody>
                {data.ranking.map((r) => (
                  <tr key={r.orgId} className="border-b border-gray-50">
                    <td className="py-2.5 font-bold text-gray-400">{r.rank}</td>
                    <td className="py-2.5 font-semibold text-gray-900">{r.orgName}</td>
                    <td className="py-2.5">
                      <div className="relative flex h-6 items-center overflow-hidden rounded">
                        <div className="absolute inset-y-0 left-0 rounded bg-[#E8F4F8]" style={{ width: `${r.barPct}%` }} />
                        <span className="relative pl-2 text-xs font-bold text-gray-900">{fmtEur(r.amountEur)}</span>
                      </div>
                    </td>
                    <td className="py-2.5 text-gray-500">{r.pctOfTotal.toFixed(1)}%</td>
                    <td className="py-2.5 text-gray-500">{r.requestCount.toLocaleString('en-US')}</td>
                    <td className="py-2.5 text-gray-500">{r.tokensTotal > 0 ? r.tokensTotal.toLocaleString('en-US') : '—'}</td>
                    <td className="py-2.5 text-gray-500">{r.topMechanism}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.sharedCatalog30dEur > 0 && (
          <p className="mt-3 border-t border-gray-100 pt-2 text-xs text-gray-500">
            Shared catalog — benefits every org ({fmtEur(data.sharedCatalog30dEur)}, not attributed to any single startup above).
          </p>
        )}
      </div>
    </div>
  );
}
