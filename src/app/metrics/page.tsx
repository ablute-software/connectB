'use client';
// Prompt 122 Block A (F0.5) — Metrics promoted out of the Back-office
// console into the founder Shell's own sidebar (Platform section, right
// below "Back-office →"): moved verbatim from src/app/backoffice/metrics
// /page.tsx, which now just redirects here so old bookmarks keep working.
// Still platform-admin only — enforced the same way /backoffice always was
// (middleware.ts's BLOCO 3 gate now also covers /metrics; every
// /api/backoffice/metrics/* route this page calls still independently
// checks requirePlatformAdmin()).
//
// SherlockDeal_Metricas_BackOffice_V1 — the metrics dashboard, 5 tabs per
// Section 5 (Overview, Growth & Revenue, Activation & Retention,
// Fundraising Outcomes, Organizations). "Product & Network" is
// deliberately not a 6th tab (spec: adiado para V2, though Prompt 122
// Block C now adds "Ecosystem" as the actual 6th tab); "Operations" folds
// into Overview's alerts area (kept) plus this page's own Audit log panel
// (Prompt 69, kept as-is).
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { describeAuditEvent, type AuditLogRow } from '@/lib/audit-log-format';
import { GrowthRevenueTab } from '@/components/backoffice/metrics/GrowthRevenueTab';
import { ActivationRetentionTab } from '@/components/backoffice/metrics/ActivationRetentionTab';
import { FundraisingOutcomesTab } from '@/components/backoffice/metrics/FundraisingOutcomesTab';
import { OrganizationsTab } from '@/components/backoffice/metrics/OrganizationsTab';
import { PeriodPicker, type Period } from '@/components/backoffice/metrics/PeriodPicker';
import { HistoricalDataNotice } from '@/components/backoffice/metrics/HistoricalDataNotice';
import { EcosystemTab } from '@/components/backoffice/metrics/EcosystemTab';
import { MatchDealTab } from '@/components/backoffice/metrics/MatchDealTab';
import { SampleCoverageTab } from '@/components/backoffice/metrics/SampleCoverageTab';
import { MethodologyTab } from '@/components/backoffice/metrics/MethodologyTab';
import { MetricDrillDown, type DrillDownSeries } from '@/components/backoffice/metrics/MetricDrillDown';
import { UsageRankingTab } from '@/components/backoffice/metrics/UsageRankingTab';

// Prompt 124 §0 — two floors, not a flat row of tabs: the rules differ (the
// app floor can show individual accounts; Ecosystem never does — K=8 RPCs),
// the time horizon differs (app = last 30 days; Ecosystem = quarters/
// cohorts), and Ecosystem only gets real screen space if it isn't competing
// with a row of 7 tabs.
type Floor = 'app' | 'ecosystem';
type AppTab = 'overview' | 'growth' | 'activation' | 'fundraising' | 'organizations' | 'matchdeal' | 'usage';
type EcosystemTabKey = 'xray' | 'sample-coverage' | 'methodology';

const APP_TABS: { key: AppTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'growth', label: 'Growth & Revenue' },
  { key: 'activation', label: 'Activation & Retention' },
  { key: 'fundraising', label: 'Fundraising Outcomes' },
  { key: 'organizations', label: 'Organizations' },
  { key: 'matchdeal', label: 'MatchDeal' },
  // Prompt 296 §4 — CRM usage ranking (by org/person). Lives here for now,
  // in the current tab shell; Prompt 294's backoffice redesign (branch
  // backoffice-redesign, not yet merged) may give this its own nav location
  // once it lands — flagged per that prompt's own explicit sequencing note.
  { key: 'usage', label: 'Usage' },
];
const ECOSYSTEM_TABS: { key: EcosystemTabKey; label: string }[] = [
  { key: 'xray', label: 'X-Ray' },
  { key: 'sample-coverage', label: 'Sample & coverage' },
  { key: 'methodology', label: 'Methodology' },
];

type AuditRow = AuditLogRow & { adminName: string };

function AuditLogRowView({ row }: { row: AuditRow }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-gray-50 py-2 last:border-0">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-xs text-gray-400">{row.created_at.slice(0, 16).replace('T', ' ')}</span>
        <span className="text-sm text-gray-800">{describeAuditEvent(row, row.adminName)}</span>
        <button onClick={() => setOpen(!open)} className="ml-auto text-xs text-[#0E7490] hover:underline">
          {open ? 'Hide details' : 'Details'}
        </button>
      </div>
      {open && (
        <pre className="mt-1.5 overflow-x-auto rounded-lg bg-gray-50 p-2 text-[11px] text-gray-600">
          {JSON.stringify({ action: row.action, subject_type: row.subject_type, subject_id: row.subject_id, detail: row.detail }, null, 2)}
        </pre>
      )}
    </li>
  );
}

function AuditLogPanel() {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [admins, setAdmins] = useState<{ id: string; label: string }[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [adminUserId, setAdminUserId] = useState('');
  const [loadedOnce, setLoadedOnce] = useState(false);

  function load(offset: number, append: boolean) {
    setLoading(true); setErr('');
    const params = new URLSearchParams({ offset: String(offset) });
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (adminUserId) params.set('adminUserId', adminUserId);
    fetch(`/api/backoffice/audit-log?${params}`).then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); setLoading(false); return; }
      setRows((prev) => append ? [...prev, ...body.rows] : body.rows);
      setAdmins(body.admins);
      setHasMore(body.hasMore);
      setTotal(body.total);
      setLoading(false);
    }).catch(() => { setErr('Failed to load.'); setLoading(false); });
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && !loadedOnce) { setLoadedOnce(true); load(0, false); }
  }
  function applyFilters() { load(0, false); }

  return (
    <Card
      title={`Audit log — every admin action ${expanded ? '▾' : '▸'}`}
      right={<button onClick={toggle} className="text-xs font-medium text-[#0E7490] hover:underline">{expanded ? 'Collapse' : 'Expand'}</button>}
    >
      {!expanded ? (
        <p className="text-sm text-gray-400">Who did what, when — collapsed by default. Click Expand to view.</p>
      ) : (
        <div>
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className="text-xs text-gray-500">
              From
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs text-gray-500">
              To
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm" />
            </label>
            <label className="text-xs text-gray-500">
              Admin
              <select value={adminUserId} onChange={(e) => setAdminUserId(e.target.value)} className="mt-0.5 block rounded-lg border border-gray-300 px-2 py-1 text-sm">
                <option value="">All admins</option>
                {admins.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </label>
            <button onClick={applyFilters} disabled={loading} className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40">
              Apply
            </button>
            {(from || to || adminUserId) && (
              <button onClick={() => { setFrom(''); setTo(''); setAdminUserId(''); load(0, false); }} className="text-xs text-gray-400 hover:underline">
                Clear filters
              </button>
            )}
          </div>

          {err && <p className="text-sm text-[#B00000]">{err}</p>}
          {!err && rows.length === 0 && !loading && <p className="text-sm text-gray-400">No admin actions match these filters.</p>}
          {rows.length > 0 && (
            <>
              <p className="mb-1 text-xs text-gray-400">Showing {rows.length} of {total}</p>
              <ul>{rows.map((r) => <AuditLogRowView key={r.id} row={r} />)}</ul>
            </>
          )}
          {hasMore && (
            <button onClick={() => load(rows.length, true)} disabled={loading}
              className="mt-2 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </Card>
  );
}

interface OverviewData {
  growth: {
    newStartups: { value: number; deltaPct: number | null };
    // Prompt 124 M9/C7 — split, never one combined "new investors" number.
    newCatalogEntities: { value: number; deltaPct: number | null };
    newRegisteredInvestorAccounts: { value: number; deltaPct: number | null };
    activatedStartups: number; activeFundraisingStartups: number; startupsWithRelevantActivity: number;
    activationRate7d: number | null; retention30d: number | null;
  };
  revenue: {
    mrr: number; mrrPotential: number; mrrBilled: number; discountsValue: number; netNewMrr: number;
    freeToPaidConversion: { rate: number | null; normal: number; promo: number }; monthlyRevenueChurnPct: number | null;
  };
  valueProof: { qualifiedConversations: number; medianDaysToFirstResponse: number | null };
  alerts: { failedAutomations: number; hardBounces: number; overduePipelines: number; failedPayments: number };
}

// Prompt 296 §2 — every Stat is clickable when it names its own history
// path(s); the click opens MetricDrillDown with a trend built from
// metrics_snapshots. Cards with no onClick (none currently — every Overview
// field is captured in the snapshot payload) fall back to a plain, inert card.
function Stat({ label, value, hint, delta, onClick }: { label: string; value: string | number; hint?: string; delta?: number | null; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      className={`rounded-2xl border border-gray-100 bg-white p-4 shadow-sm ${onClick ? 'cursor-pointer transition hover:border-[#0E7490] hover:shadow-md' : ''}`}
    >
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-[#0E7490]">{value}</span>
        {delta != null && (
          <span className={`text-xs font-semibold ${delta >= 0 ? 'text-green-700' : 'text-[#B00000]'}`}>
            {delta >= 0 ? '+' : ''}{delta}%
          </span>
        )}
      </div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
      {hint && <div className="mt-0.5 text-[10px] text-gray-400">{hint}</div>}
    </div>
  );
}

interface Staleness { lastSnapshotAt: string | null; eventsSinceSnapshot: number; worthRefreshing: boolean }
interface DrillDownState { title: string; series: DrillDownSeries[]; entitiesMetric?: string; period?: string }

function fmtEurReal(n: number): string { return `€${Math.round(n).toLocaleString()}`; }

function OverviewTab() {
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<OverviewData | null>(null);
  const [err, setErr] = useState('');
  const [staleness, setStaleness] = useState<Staleness | null>(null);
  const [showStalenessPopup, setShowStalenessPopup] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [drillDown, setDrillDown] = useState<DrillDownState | null>(null);

  useEffect(() => {
    setErr('');
    if (period !== '30d') {
      // Prompt 296 §1 — the cache/popup mechanism only exists for the 30d
      // window (the only one metrics_snapshots ever stores); any other
      // period always live-computes, exactly as before this prompt.
      fetch(`/api/backoffice/metrics/overview?period=${period}`).then((r) => r.json()).then((body) => {
        if (body.ok === false) { setErr(body.error); return; }
        setData(body);
      }).catch(() => setErr('Failed to load.'));
      return;
    }
    // Default load: serve the cached snapshot instantly instead of
    // recomputing every indicator on every page open — the live route is
    // still there for "Atualizar agora" and for the very first-ever load.
    fetch('/api/backoffice/metrics/overview/cached').then((r) => r.json()).then((body) => {
      if (body.ok) { setData(body); return; }
      fetch('/api/backoffice/metrics/overview?period=30d').then((r2) => r2.json()).then((body2) => {
        if (body2.ok === false) { setErr(body2.error); return; }
        setData(body2);
      }).catch(() => setErr('Failed to load.'));
    }).catch(() => setErr('Failed to load.'));

    fetch('/api/backoffice/metrics/overview/staleness').then((r) => r.json()).then((body) => {
      if (body.ok && body.worthRefreshing) { setStaleness(body); setShowStalenessPopup(true); }
    }).catch(() => {});
  }, [period]);

  async function refreshNow() {
    setRefreshing(true);
    try {
      const res = await fetch('/api/backoffice/metrics/overview/refresh', { method: 'POST' });
      const body = await res.json();
      if (body.ok) { setData(body); setErr(''); }
    } finally { setRefreshing(false); setShowStalenessPopup(false); }
  }

  return (
    <div className="space-y-5">
      <PeriodPicker period={period} onChange={setPeriod} />
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      {!data ? <p className="text-sm text-gray-400">Loading…</p> : (
        <>
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Growth</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="New startups" value={data.growth.newStartups.value} delta={data.growth.newStartups.deltaPct}
                onClick={() => setDrillDown({
                  title: 'New startups', period,
                  series: [{ path: 'growth.newStartups.value', label: 'New startups', color: '#0E7490' }],
                  entitiesMetric: 'newStartups',
                })} />
              <Stat label="Catalog entities added" value={data.growth.newCatalogEntities.value} delta={data.growth.newCatalogEntities.deltaPct}
                hint="imported/enriched — not necessarily a real account"
                onClick={() => setDrillDown({ title: 'Catalog entities added', series: [{ path: 'growth.newCatalogEntities.value', label: 'Catalog entities', color: '#7c3aed' }] })} />
              <Stat label="Investor accounts registered" value={data.growth.newRegisteredInvestorAccounts.value} delta={data.growth.newRegisteredInvestorAccounts.deltaPct}
                hint="a real person actually signed in"
                onClick={() => setDrillDown({ title: 'Investor accounts registered', series: [{ path: 'growth.newRegisteredInvestorAccounts.value', label: 'Registered accounts', color: '#2563eb' }] })} />
              <Stat label="Startups activated" value={data.growth.activatedStartups}
                onClick={() => setDrillDown({ title: 'Startups activated', series: [{ path: 'growth.activatedStartups', label: 'Activated', color: '#16a34a' }] })} />
              <Stat label="Startups with active round" value={data.growth.activeFundraisingStartups}
                onClick={() => setDrillDown({
                  title: 'Startups with active round', period,
                  series: [{ path: 'growth.activeFundraisingStartups', label: 'Active round', color: '#d97706' }],
                  entitiesMetric: 'activeFundraisingStartups',
                })} />
              <Stat label="Relevant activity" value={data.growth.startupsWithRelevantActivity} hint="in the selected period"
                onClick={() => setDrillDown({ title: 'Relevant activity', series: [{ path: 'growth.startupsWithRelevantActivity', label: 'Relevant activity', color: '#db2777' }] })} />
              <Stat label="7-day activation rate" value={data.growth.activationRate7d != null ? `${data.growth.activationRate7d}%` : '—'}
                onClick={() => setDrillDown({ title: '7-day activation rate', series: [{ path: 'growth.activationRate7d', label: 'Activation rate', color: '#0E7490', formatValue: (v) => `${v}%` }] })} />
              <Stat label="30-day retention" value={data.growth.retention30d != null ? `${data.growth.retention30d}%` : '—'}
                onClick={() => setDrillDown({ title: '30-day retention', series: [{ path: 'growth.retention30d', label: 'Retention', color: '#64748b', formatValue: (v) => `${v}%` }] })} />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Revenue</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat
                label="MRR — billed · at plan · list"
                value={`${fmtEurReal(data.revenue.mrrBilled)} billed · ${fmtEurReal(data.revenue.mrr)} at plan`}
                onClick={() => setDrillDown({
                  title: 'MRR — billed vs. at plan vs. list price',
                  series: [
                    { path: 'revenue.mrrBilled', label: 'Billed (active Stripe subscription)', color: '#0E7490', formatValue: fmtEurReal },
                    { path: 'revenue.mrr', label: 'Charged at plan (post-discount)', color: '#64748B', formatValue: fmtEurReal },
                    { path: 'revenue.mrrPotential', label: 'List price', color: '#CBD5E1', formatValue: fmtEurReal },
                  ],
                })}
              />
              <Stat label="Net New MRR" value={`€${data.revenue.netNewMrr.toLocaleString()}`}
                onClick={() => setDrillDown({ title: 'Net New MRR', series: [{ path: 'revenue.netNewMrr', label: 'Net New MRR', color: '#16a34a', formatValue: fmtEurReal }] })} />
              <Stat label="Free → Paid conversion" value={data.revenue.freeToPaidConversion.rate != null ? `${data.revenue.freeToPaidConversion.rate}%` : '—'}
                hint={`${data.revenue.freeToPaidConversion.normal} at list price · ${data.revenue.freeToPaidConversion.promo} via promo`}
                onClick={() => setDrillDown({ title: 'Free → Paid conversion', series: [{ path: 'revenue.freeToPaidConversion.rate', label: 'Conversion rate', color: '#7c3aed', formatValue: (v) => `${v}%` }] })} />
              <Stat label="Monthly revenue churn" value={data.revenue.monthlyRevenueChurnPct != null ? `${data.revenue.monthlyRevenueChurnPct}%` : '—'}
                onClick={() => setDrillDown({ title: 'Monthly revenue churn', series: [{ path: 'revenue.monthlyRevenueChurnPct', label: 'Churn', color: '#B00000', formatValue: (v) => `${v}%` }] })} />
            </div>
            {data.revenue.discountsValue > 0 && (
              <p className="mt-2 text-[11px] text-gray-400">
                €{data.revenue.discountsValue.toLocaleString()}/mo of the potential total is currently being discounted by active promo codes.
              </p>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Proof of value</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Qualified conversations / active round" value={data.valueProof.qualifiedConversations}
                hint="relations that reached In conversation, Diligence, or Invested"
                onClick={() => setDrillDown({ title: 'Qualified conversations', series: [{ path: 'valueProof.qualifiedConversations', label: 'Conversations', color: '#0E7490' }] })} />
              <Stat label="Median days to first response" value={data.valueProof.medianDaysToFirstResponse ?? '—'}
                onClick={() => setDrillDown({ title: 'Median days to first response', series: [{ path: 'valueProof.medianDaysToFirstResponse', label: 'Median days', color: '#d97706' }] })} />
            </div>
            <HistoricalDataNotice />
          </div>

          <Card title="Operational alerts">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Failed automations (30d)" value={data.alerts.failedAutomations} />
              <Stat label="Hard bounces (30d)" value={data.alerts.hardBounces} />
              <Stat label="Overdue pipelines" value={data.alerts.overduePipelines} hint="registered >48h, no pipeline yet" />
              <Stat label="Failed payments" value={data.alerts.failedPayments} hint="not wired yet — see report" />
            </div>
          </Card>

          <AuditLogPanel />
        </>
      )}

      {showStalenessPopup && staleness && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h3 className="text-base font-bold text-gray-900">Atualizar os dados?</h3>
            <p className="mt-2 text-sm text-gray-600">
              {staleness.lastSnapshotAt
                ? `Houve ${staleness.eventsSinceSnapshot} eventos registados desde a última captura (${new Date(staleness.lastSnapshotAt).toLocaleString('pt-PT')}). Os números abaixo podem já não refletir isso.`
                : 'Ainda não existe nenhuma captura guardada — a mostrar um cálculo em tempo real.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={refreshNow} disabled={refreshing}
                className="rounded-lg bg-[#0E7490] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40">
                {refreshing ? 'A atualizar…' : 'Atualizar agora'}
              </button>
              <button onClick={() => setShowStalenessPopup(false)}
                className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50">
                Manter os dados actuais
              </button>
              <button onClick={() => setShowStalenessPopup(false)} className="rounded-lg px-3 py-1.5 text-xs text-gray-400 hover:underline">
                Adiar
              </button>
            </div>
          </div>
        </div>
      )}

      {drillDown && (
        <MetricDrillDown
          title={drillDown.title}
          series={drillDown.series}
          entitiesMetric={drillDown.entitiesMetric}
          period={drillDown.period}
          onClose={() => setDrillDown(null)}
        />
      )}
    </div>
  );
}

export default function MetricsPage() {
  const [floor, setFloor] = useState<Floor>('app');
  const [appTab, setAppTab] = useState<AppTab>('overview');
  const [ecosystemTab, setEcosystemTab] = useState<EcosystemTabKey>('xray');

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Metrics</h1>

      {/* Top-of-page segmented control — the two floors. */}
      <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
        {(['app', 'ecosystem'] as Floor[]).map((f) => (
          <button key={f} onClick={() => setFloor(f)}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${
              floor === f ? 'bg-white text-[#0E7490] shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
            {f === 'app' ? 'Sherlock Deal & app' : 'Ecosystem'}
          </button>
        ))}
      </div>

      {floor === 'app' ? (
        <>
          <nav className="flex gap-1 overflow-x-auto border-b border-gray-100">
            {APP_TABS.map((t) => (
              <button key={t.key} onClick={() => setAppTab(t.key)}
                className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
                  appTab === t.key ? 'border-[#0E7490] text-[#0E7490]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                {t.label}
              </button>
            ))}
          </nav>
          {appTab === 'overview' && <OverviewTab />}
          {appTab === 'growth' && <GrowthRevenueTab />}
          {appTab === 'activation' && <ActivationRetentionTab />}
          {appTab === 'fundraising' && <FundraisingOutcomesTab />}
          {appTab === 'organizations' && <OrganizationsTab />}
          {appTab === 'matchdeal' && <MatchDealTab />}
          {appTab === 'usage' && <UsageRankingTab />}
        </>
      ) : (
        <>
          <nav className="flex gap-1 overflow-x-auto border-b border-gray-100">
            {ECOSYSTEM_TABS.map((t) => (
              <button key={t.key} onClick={() => setEcosystemTab(t.key)}
                className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
                  ecosystemTab === t.key ? 'border-[#0E7490] text-[#0E7490]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
                {t.label}
              </button>
            ))}
          </nav>
          {ecosystemTab === 'xray' && <EcosystemTab />}
          {ecosystemTab === 'sample-coverage' && <SampleCoverageTab />}
          {ecosystemTab === 'methodology' && <MethodologyTab />}
        </>
      )}
    </div>
  );
}
