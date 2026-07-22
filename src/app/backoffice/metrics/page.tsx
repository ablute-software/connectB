'use client';
// BLOCO 3 — Métricas: platform-wide counts + the audit log tail (the
// who/what/when record every admin mutation writes).
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface Metrics {
  totalOrgs: number; activeOrgsThisWeek: number; contributionsThisWeek: number;
  totalUnlocks: number; emailsThisWeek: number; failedAutomationsThisWeek: number;
}
interface AuditRow { id: string; admin_user_id: string | null; action: string; subject_type: string; subject_id: string | null; detail: unknown; created_at: string }

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
      <div className="text-2xl font-bold text-[#0E7490]">{value}</div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
    </div>
  );
}

export default function BackofficeMetricsPage() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [auditLog, setAuditLog] = useState<AuditRow[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/metrics').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setMetrics(body.metrics); setAuditLog(body.auditLog);
    });
  }, []);

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!metrics) return <p className="text-sm text-gray-400">Loading…</p>;

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Métricas</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <StatCard label="Total orgs (signups)" value={metrics.totalOrgs} />
        <StatCard label="Active orgs this week" value={metrics.activeOrgsThisWeek} />
        <StatCard label="Contributions this week" value={metrics.contributionsThisWeek} />
        <StatCard label="Pack unlocks (total)" value={metrics.totalUnlocks} />
        <StatCard label="Emails sent this week" value={metrics.emailsThisWeek} />
        <StatCard label="Failed automations this week" value={metrics.failedAutomationsThisWeek} />
      </div>

      <Card title="Audit log — every admin action">
        {!auditLog || auditLog.length === 0 ? <p className="text-sm text-gray-400">No admin actions recorded yet.</p> : (
          <ul className="space-y-1.5 text-sm">
            {auditLog.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-gray-400">{a.created_at.slice(0, 16).replace('T', ' ')}</span>
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-700">{a.action}</span>
                <span className="text-xs text-gray-500">{a.subject_type}{a.subject_id ? ` · ${a.subject_id.slice(0, 8)}` : ''}</span>
                {!!a.detail && <span className="max-w-md truncate text-xs text-gray-400">{JSON.stringify(a.detail)}</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
