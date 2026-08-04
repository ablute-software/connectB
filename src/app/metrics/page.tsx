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

type Tab = 'overview' | 'growth' | 'activation' | 'fundraising' | 'organizations';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'growth', label: 'Growth & Revenue' },
  { key: 'activation', label: 'Activation & Retention' },
  { key: 'fundraising', label: 'Fundraising Outcomes' },
  { key: 'organizations', label: 'Organizations' },
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
    newInvestors: { value: number; deltaPct: number | null };
    activatedStartups: number; activeFundraisingStartups: number; startupsWithRelevantActivity: number;
    activationRate7d: number | null; retention30d: number | null;
  };
  revenue: { mrr: number; netNewMrr: number; freeToPaidConversion: { rate: number | null; normal: number; promo: number }; monthlyRevenueChurnPct: number | null };
  valueProof: { qualifiedConversations: number; medianDaysToFirstResponse: number | null };
  alerts: { failedAutomations: number; hardBounces: number; overduePipelines: number; failedPayments: number };
}

function Stat({ label, value, hint, delta }: { label: string; value: string | number; hint?: string; delta?: number | null }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 shadow-sm">
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

function OverviewTab() {
  const [period, setPeriod] = useState<Period>('30d');
  const [data, setData] = useState<OverviewData | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch(`/api/backoffice/metrics/overview?period=${period}`).then((r) => r.json()).then((body) => {
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
          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Growth</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="New startups" value={data.growth.newStartups.value} delta={data.growth.newStartups.deltaPct} />
              <Stat label="New investors" value={data.growth.newInvestors.value} delta={data.growth.newInvestors.deltaPct} />
              <Stat label="Startups activated" value={data.growth.activatedStartups} />
              <Stat label="Startups with active round" value={data.growth.activeFundraisingStartups} />
              <Stat label="Relevant activity" value={data.growth.startupsWithRelevantActivity} hint="in the selected period" />
              <Stat label="7-day activation rate" value={data.growth.activationRate7d != null ? `${data.growth.activationRate7d}%` : '—'} />
              <Stat label="30-day retention" value={data.growth.retention30d != null ? `${data.growth.retention30d}%` : '—'} />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Revenue</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="MRR" value={`€${data.revenue.mrr.toLocaleString()}`} />
              <Stat label="Net New MRR" value={`€${data.revenue.netNewMrr.toLocaleString()}`} />
              <Stat label="Free → Paid conversion" value={data.revenue.freeToPaidConversion.rate != null ? `${data.revenue.freeToPaidConversion.rate}%` : '—'}
                hint={`${data.revenue.freeToPaidConversion.normal} at list price · ${data.revenue.freeToPaidConversion.promo} via promo`} />
              <Stat label="Monthly revenue churn" value={data.revenue.monthlyRevenueChurnPct != null ? `${data.revenue.monthlyRevenueChurnPct}%` : '—'} />
            </div>
          </div>

          <div>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Proof of value</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="Qualified conversations / active round" value={data.valueProof.qualifiedConversations}
                hint="relations that reached In conversation, Diligence, or Invested" />
              <Stat label="Median days to first response" value={data.valueProof.medianDaysToFirstResponse ?? '—'} />
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
    </div>
  );
}

export default function MetricsPage() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Metrics</h1>
      <nav className="flex gap-1 overflow-x-auto border-b border-gray-100">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium ${
              tab === t.key ? 'border-[#0E7490] text-[#0E7490]' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'growth' && <GrowthRevenueTab />}
      {tab === 'activation' && <ActivationRetentionTab />}
      {tab === 'fundraising' && <FundraisingOutcomesTab />}
      {tab === 'organizations' && <OrganizationsTab />}
    </div>
  );
}
