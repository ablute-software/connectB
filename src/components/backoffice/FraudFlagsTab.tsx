'use client';
// Prompt 277 A.3 — backoffice review queue for founder-submitted fraud/
// scam reports (entity_fraud_flags, migration 0196). Deliberately its own,
// smaller mechanism, not an extension of SuspiciousAccountsTab.tsx/
// ModerationTargetType — confirmed by reading that mechanism first: it's
// admin-write-only at every layer (RLS, route, by design), and its three
// actions (alert_email/suspend/delete_and_block) assume a real platform
// account with a login, neither of which fits "a founder is reporting a
// directory listing they're investigating." Same evidence/pending-
// actioned SHAPE as that queue, reused deliberately — just one terminal
// review decision per flag instead of a repeatable action history, since
// this queue only ever asks "was this report right or not."
import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';

interface FraudFlag {
  id: string; entityId: string; entityName: string; orgName: string; catalogId: string | null;
  justification: string; evidence: string; flaggedBy: string; flaggedAt: string;
  status: 'pending' | 'actioned'; outcome: 'confirmed' | 'dismissed' | null;
  reviewedBy: string | null; reviewedAt: string | null; reviewerNotes: string | null;
}

function FlagRow({ flag, onResolved }: { flag: FraudFlag; onResolved: () => void }) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState('');
  const [suspendCatalogEntity, setSuspendCatalogEntity] = useState(true);
  const [busy, setBusy] = useState<'confirmed' | 'dismissed' | null>(null);
  const [err, setErr] = useState('');

  async function resolve(outcome: 'confirmed' | 'dismissed') {
    setBusy(outcome); setErr('');
    try {
      const res = await fetch(`/api/backoffice/fraud-flags/${flag.id}/resolve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outcome, notes: notes.trim() || undefined, suspendCatalogEntity: outcome === 'confirmed' && suspendCatalogEntity }),
      });
      const body = await res.json();
      if (!body.ok) { setErr(body.error); return; }
      onResolved();
    } finally {
      setBusy(null);
    }
  }

  return (
    <li className="rounded-lg border border-gray-100">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left hover:bg-gray-50">
        <span className="font-medium">{flag.entityName}</span>
        <span className="text-xs text-gray-400">({flag.orgName})</span>
        {!flag.catalogId && <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-500" title="Never reached the shared catalog — a purely manual entry.">not catalog-linked</span>}
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
          flag.status === 'pending' ? 'bg-amber-50 text-amber-700'
            : flag.outcome === 'confirmed' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {flag.status === 'pending' ? 'pending' : flag.outcome}
        </span>
        <span className="ml-auto text-xs text-gray-400">reported by {flag.flaggedBy} · {new Date(flag.flaggedAt).toLocaleString()}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-gray-100 px-3 py-3 text-sm">
          <div>
            <p className="text-[11px] font-semibold uppercase text-gray-400">Justification</p>
            <p className="whitespace-pre-wrap text-gray-700">{flag.justification}</p>
          </div>
          <div>
            <p className="text-[11px] font-semibold uppercase text-gray-400">Evidence</p>
            <p className="whitespace-pre-wrap text-gray-700">{flag.evidence}</p>
          </div>
          {flag.status === 'pending' ? (
            <div className="space-y-2 border-t border-gray-100 pt-2">
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Review notes (optional)"
                className="w-full rounded border border-gray-200 p-1.5 text-xs" />
              {flag.catalogId && (
                <label className="flex items-center gap-1.5 text-xs text-gray-600">
                  <input type="checkbox" checked={suspendCatalogEntity} onChange={(e) => setSuspendCatalogEntity(e.target.checked)} />
                  Also suspend this investor in the shared catalog (protects every other founder, not just this one)
                </label>
              )}
              {err && <p className="text-xs text-[#B00000]">{err}</p>}
              <div className="flex gap-2">
                <button disabled={!!busy} onClick={() => resolve('confirmed')}
                  className="rounded bg-red-700 px-2.5 py-1 text-xs font-medium text-white disabled:opacity-40">
                  {busy === 'confirmed' ? 'Confirming…' : 'Confirm — this is fraud'}
                </button>
                <button disabled={!!busy} onClick={() => resolve('dismissed')}
                  className="rounded border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-600 hover:bg-gray-100 disabled:opacity-40">
                  {busy === 'dismissed' ? 'Dismissing…' : 'Dismiss — not fraud'}
                </button>
              </div>
            </div>
          ) : (
            <div className="border-t border-gray-100 pt-2 text-xs text-gray-500">
              {flag.outcome === 'confirmed' ? 'Confirmed' : 'Dismissed'} by {flag.reviewedBy} · {flag.reviewedAt ? new Date(flag.reviewedAt).toLocaleString() : ''}
              {flag.reviewerNotes && <div className="mt-0.5 text-gray-600">{flag.reviewerNotes}</div>}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function FraudFlagsTab() {
  const [flags, setFlags] = useState<FraudFlag[] | null>(null);
  const [err, setErr] = useState('');

  function refresh() {
    fetch('/api/backoffice/fraud-flags').then((r) => r.json()).then((body) => {
      if (body.ok === false) { setErr(body.error); return; }
      setFlags(body.flags);
    });
  }
  useEffect(refresh, []);

  const pending = (flags ?? []).filter((f) => f.status === 'pending');
  const actioned = (flags ?? []).filter((f) => f.status === 'actioned');

  return (
    <div className="space-y-4">
      {err && <p className="text-sm text-[#B00000]">{err}</p>}
      <Card title={`Fraud/scam reports — pending (${pending.length})`}>
        {!flags ? <p className="text-sm text-gray-400">Loading…</p> : pending.length === 0 ? (
          <p className="text-sm text-gray-400">Nothing pending review.</p>
        ) : (
          <ul className="space-y-2">{pending.map((f) => <FlagRow key={f.id} flag={f} onResolved={refresh} />)}</ul>
        )}
      </Card>
      {actioned.length > 0 && (
        <Card title={`Reviewed (${actioned.length})`}>
          <ul className="space-y-2">{actioned.map((f) => <FlagRow key={f.id} flag={f} onResolved={refresh} />)}</ul>
        </Card>
      )}
    </div>
  );
}
