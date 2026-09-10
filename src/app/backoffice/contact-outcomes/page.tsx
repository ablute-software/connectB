'use client';
// Prompt 585 §G.3 — "Lista 'No-link verdicts'... e painel 'Contact
// outcomes'." One page, two sections — same "fold into one shelf rather
// than invent a second nav entry" call this branch already made for
// Phase 3's evidence queue.
import { useEffect, useState } from 'react';

interface Summary {
  totalSent: number; totalReplied: number; responseRate: number | null;
  withHookSent: number; withHookReplied: number; withHookResponseRate: number | null;
  withoutHookSent: number; withoutHookReplied: number; withoutHookResponseRate: number | null;
  byVerdict: Record<string, { sent: number; replied: number; responseRate: number | null }>;
}
interface OutcomeRow {
  id: string; channel: string; sentAt: string; repliedAt: string | null; hasHook: boolean;
  hookVerdict: string | null; orgName: string; entityName: string; personName: string | null;
}
interface NoLinkRow {
  id: string; channel: string; createdAt: string; reasonIfNone: string | null;
  orgName: string; target: string; entityName: string;
}

function pct(v: number | null): string { return v == null ? '—' : `${Math.round(v * 100)}%`; }
function stamp(iso: string): string { return iso.slice(0, 16).replace('T', ' '); }

export default function ContactOutcomesPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<OutcomeRow[]>([]);
  const [noLinkRows, setNoLinkRows] = useState<NoLinkRow[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    fetch('/api/backoffice/contact-outcomes', { cache: 'no-store' }).then((r) => r.json())
      .then((b) => { if (b.ok) { setSummary(b.summary); setRows(b.rows ?? []); } else setErr(b.error ?? 'Could not load.'); })
      .catch(() => setErr('Could not load contact outcomes.'));
    fetch('/api/backoffice/no-link-verdicts', { cache: 'no-store' }).then((r) => r.json())
      .then((b) => { if (b.ok) setNoLinkRows(b.rows ?? []); })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-lg font-semibold text-gray-900">Contact outcomes</h1>
      {err && <p className="text-sm text-[#B00000]">{err}</p>}

      {/* §F.9 — "a linha de base que decide se a IA volta a entrar noutro
          sítio — não antes." */}
      {summary && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Overall response rate</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{pct(summary.responseRate)}</p>
            <p className="text-xs text-gray-500">{summary.totalReplied} of {summary.totalSent} sent</p>
          </div>
          <div className="rounded-lg border border-cyan-200 bg-cyan-50/40 p-4">
            <p className="text-[11px] uppercase tracking-wide text-cyan-700">With a hook used</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{pct(summary.withHookResponseRate)}</p>
            <p className="text-xs text-gray-500">{summary.withHookReplied} of {summary.withHookSent} sent</p>
          </div>
          <div className="rounded-lg border border-gray-200 p-4">
            <p className="text-[11px] uppercase tracking-wide text-gray-400">Without a hook</p>
            <p className="mt-1 text-2xl font-semibold text-gray-900">{pct(summary.withoutHookResponseRate)}</p>
            <p className="text-xs text-gray-500">{summary.withoutHookReplied} of {summary.withoutHookSent} sent</p>
          </div>
        </div>
      )}

      {summary && Object.keys(summary.byVerdict).length > 0 && (
        <div className="rounded-lg border border-gray-200 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">By hook verdict</p>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400"><th>Verdict</th><th>Sent</th><th>Replied</th><th>Rate</th></tr></thead>
            <tbody>
              {Object.entries(summary.byVerdict).map(([verdict, v]) => (
                <tr key={verdict} className="border-t border-gray-50">
                  <td className="py-1 capitalize">{verdict}</td><td>{v.sent}</td><td>{v.replied}</td><td>{pct(v.responseRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">Recent outreach ({rows.length})</p>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400"><th className="p-2">Org</th><th>Fund</th><th>Person</th><th>Channel</th><th>Hook</th><th>Sent</th><th>Replied</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-gray-50">
                  <td className="p-2">{r.orgName}</td><td>{r.entityName}</td><td>{r.personName ?? '—'}</td><td>{r.channel}</td>
                  <td>{r.hasHook ? (r.hookVerdict ?? 'yes') : '—'}</td>
                  <td className="text-xs text-gray-500">{stamp(r.sentAt)}</td>
                  <td className="text-xs">{r.repliedAt ? <span className="text-green-700">{stamp(r.repliedAt)}</span> : <span className="text-gray-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* §G.3 — "No-link verdicts" (org, alvo, data, reason_if_none): every
          verdict='none' hook request, for human review — no automated
          action taken on these, per §F.6 (position-only, this org only). */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">No-link verdicts ({noLinkRows.length})</p>
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-gray-400"><th className="p-2">Org</th><th>Target</th><th>Fund</th><th>Channel</th><th>Reason</th><th>Date</th></tr></thead>
            <tbody>
              {noLinkRows.map((r) => (
                <tr key={r.id} className="border-t border-gray-50">
                  <td className="p-2">{r.orgName}</td><td>{r.target}</td><td>{r.entityName}</td><td>{r.channel}</td>
                  <td className="text-gray-500">{r.reasonIfNone ?? '—'}</td>
                  <td className="text-xs text-gray-500">{stamp(r.createdAt)}</td>
                </tr>
              ))}
              {noLinkRows.length === 0 && <tr><td colSpan={6} className="p-3 text-center text-gray-400">None yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
