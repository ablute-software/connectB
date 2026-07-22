'use client';
// BLOCO 3 — Hoje: the back-office landing screen. Priority queue across
// every source that has a deadline or is stalling, GDPR first (hard legal
// SLA). Direct action per row; heavier review (notes, per-field verify)
// happens on the Fila tabs this links to.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui';

interface TodayData {
  gdpr: { type: 'gdpr'; id: string; label: string; daysLeft: number; urgent: boolean }[];
  stalledContributions: { id: string; subject_type: string; field: string; org_id: string; daysStalled: number }[];
  pendingSubmissions: { id: string; org_id: string; payload: { name: string }; created_at: string }[];
  failedAutomationRuns: { id: string; org_id: string; error: string | null; created_at: string }[];
  pendingClaims: { id: string; claimant_email: string; match_score: number | null; created_at: string }[];
}

export default function BackofficeTodayPage() {
  const [data, setData] = useState<TodayData | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  function refresh() {
    fetch('/api/backoffice/today').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setData(body);
    });
  }
  useEffect(refresh, []);

  async function resolveGdpr(id: string, decision: 'resolved' | 'rejected') {
    setBusy(id);
    await fetch(`/api/backoffice/gdpr/${id}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }) });
    setBusy(null); refresh();
  }
  async function reviewSubmission(id: string, decision: 'approved' | 'rejected') {
    setBusy(id);
    await fetch(`/api/backoffice/submissions/${id}/review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }) });
    setBusy(null); refresh();
  }
  async function resolveClaim(id: string, decision: 'approved' | 'rejected') {
    setBusy(id);
    await fetch(`/api/backoffice/claims/${id}/resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }) });
    setBusy(null); refresh();
  }

  if (err) return <p className="text-sm text-[#B00000]">{err}</p>;
  if (!data) return <p className="text-sm text-gray-400">Loading…</p>;

  const nothingUrgent = data.gdpr.length === 0 && data.stalledContributions.length === 0
    && data.pendingSubmissions.length === 0 && data.failedAutomationRuns.length === 0 && data.pendingClaims.length === 0;

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Hoje</h1>

      {nothingUrgent && <Card><p className="text-sm text-gray-400">Nothing needs attention right now.</p></Card>}

      {data.gdpr.length > 0 && (
        <Card title={`GDPR / RGPD — deadline in 30 days (${data.gdpr.length})`} tint={data.gdpr.some((g) => g.urgent) ? 'red' : undefined}>
          <ul className="space-y-1.5 text-sm">
            {data.gdpr.map((g) => (
              <li key={g.id} className="flex items-center gap-2">
                <span className={g.urgent ? 'font-semibold text-[#B00000]' : g.daysLeft <= 14 ? 'font-semibold text-amber-600' : 'text-gray-400'}>
                  {g.daysLeft < 0 ? `${-g.daysLeft}d overdue` : `${g.daysLeft}d left`}
                </span>
                <span>{g.label}</span>
                <div className="ml-auto flex gap-1.5">
                  <button disabled={busy === g.id} onClick={() => resolveGdpr(g.id, 'resolved')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-40">Resolve</button>
                  <button disabled={busy === g.id} onClick={() => resolveGdpr(g.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50 disabled:opacity-40">Reject</button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.pendingSubmissions.length > 0 && (
        <Card title={`Pending submissions (${data.pendingSubmissions.length})`}>
          <ul className="space-y-1.5 text-sm">
            {data.pendingSubmissions.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="font-medium">{s.payload.name}</span>
                <span className="text-xs text-gray-400">{s.created_at.slice(0, 10)}</span>
                <div className="ml-auto flex gap-1.5">
                  <button disabled={busy === s.id} onClick={() => reviewSubmission(s.id, 'approved')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-40">Approve</button>
                  <button disabled={busy === s.id} onClick={() => reviewSubmission(s.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50 disabled:opacity-40">Reject</button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.pendingClaims.length > 0 && (
        <Card title={`Profile claims (${data.pendingClaims.length})`}>
          <ul className="space-y-1.5 text-sm">
            {data.pendingClaims.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <span>{c.claimant_email}</span>
                {c.match_score != null && <span className="text-xs text-gray-400">match {Math.round(c.match_score * 100)}%</span>}
                <div className="ml-auto flex gap-1.5">
                  <button disabled={busy === c.id} onClick={() => resolveClaim(c.id, 'approved')} className="rounded bg-green-700 px-2 py-1 text-xs font-medium text-white hover:bg-green-800 disabled:opacity-40">Approve</button>
                  <button disabled={busy === c.id} onClick={() => resolveClaim(c.id, 'rejected')} className="rounded border border-red-200 px-2 py-1 text-xs text-[#B00000] hover:bg-red-50 disabled:opacity-40">Reject</button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {data.stalledContributions.length > 0 && (
        <Card title={`Contributions stalled >7d (${data.stalledContributions.length})`}>
          <p className="mb-2 text-xs text-gray-500">Review in detail on the Fila tab (grouped by subject with sources side by side).</p>
          <ul className="space-y-1 text-sm">
            {data.stalledContributions.map((c) => (
              <li key={c.id} className="flex items-center gap-2 text-gray-600">
                <span>{c.subject_type} · {c.field}</span>
                <span className="text-xs text-gray-400">{c.daysStalled}d stalled</span>
              </li>
            ))}
          </ul>
          <Link href="/backoffice/queue" className="mt-2 inline-block text-xs text-[#0E7490] hover:underline">Open Fila →</Link>
        </Card>
      )}

      {data.failedAutomationRuns.length > 0 && (
        <Card title={`Failed automation runs, last 7d (${data.failedAutomationRuns.length})`} tint="amber">
          <ul className="space-y-1 text-sm text-gray-600">
            {data.failedAutomationRuns.map((r) => (
              <li key={r.id}>{r.error ?? 'Unknown error'} <span className="text-xs text-gray-400">— {r.created_at.slice(0, 10)}</span></li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
