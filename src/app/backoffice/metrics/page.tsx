'use client';
// BLOCO 3 — Metrics: platform-wide counts + the audit log.
//
// Prompt 69 Bloco 2 — the audit log used to be a flat, always-open list of
// raw JSON events dumped on page load. Redesigned: collapsed by default (it
// doesn't need to occupy the screen until someone actually wants it), each
// row reads as a plain-English sentence (see src/lib/audit-log-format.ts)
// instead of a technical payload, the raw JSON is still there but behind a
// per-row "Details" toggle, and it's filterable by date range + admin with
// simple "Load more" pagination instead of dumping everything at once.
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { describeAuditEvent, type AuditLogRow } from '@/lib/audit-log-format';

interface Metrics {
  totalOrgs: number; activeOrgsThisWeek: number; contributionsThisWeek: number;
  totalUnlocks: number; emailsThisWeek: number; failedAutomationsThisWeek: number;
}
type AuditRow = AuditLogRow & { adminName: string };

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="text-2xl font-bold text-[#0E7490]">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
    </div>
  );
}

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

export default function BackofficeMetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/metrics').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setMetrics(body.metrics);
    });
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!metrics) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Metrics</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Total orgs (signups)" value={metrics.totalOrgs} />
        <StatCard label="Active orgs this week" value={metrics.activeOrgsThisWeek} />
        <StatCard label="Contributions this week" value={metrics.contributionsThisWeek} />
        <StatCard label="Pack unlocks (total)" value={metrics.totalUnlocks} />
        <StatCard label="Emails sent this week" value={metrics.emailsThisWeek} />
        <StatCard label="Failed automations this week" value={metrics.failedAutomationsThisWeek} />
      </div>

      <AuditLogPanel />
    </div>
  );
}
