'use client';
// Prompt 601 §C — the admin's grant/revoke control for one org's platform
// badges, inline in the Startups table. Grants need a justification and
// (pioneer) an optional free-until date; both land in admin_audit_log
// through the route, never here.
import { useState } from 'react';
import { PlatformBadgeIcon } from '@/components/badges/PlatformBadgeIcon';
import { BADGE_LABEL, BADGE_SHORT, MANUAL_BADGES, formatDate, type PlatformBadgeKey } from '@/lib/platform-badges';

export interface AdminBadgeRow {
  id: string | null; orgId: string; badge: PlatformBadgeKey; label: string; rights: string; grantedAt: string;
  justification: string | null; freeUntil: string | null; revokedAt: string | null; lapsedAt: string | null;
  window: { elapsedPct: number; daysLeft: number; deadlineAt: string } | null;
}

export function PlatformBadgeControls({ orgId, orgName, badges, onChanged }: {
  orgId: string; orgName: string; badges: AdminBadgeRow[]; onChanged: () => void;
}) {
  const [mode, setMode] = useState<'idle' | 'grant' | { revoke: AdminBadgeRow }>('idle');
  const [badge, setBadge] = useState<PlatformBadgeKey>('tech_master');
  const [justification, setJustification] = useState('');
  const [freeUntil, setFreeUntil] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');

  const active = badges.filter((b) => !b.revokedAt);

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setErr(''); setNote('');
    try {
      const res = await fetch('/api/backoffice/platform-badges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Failed.'); return false; }
      if (body.stripe?.error) setNote(`Saved. Stripe: ${body.stripe.error}`);
      else if (body.stripe?.applied) setNote(`Saved. Stripe coupon ${body.stripe.applied} applied to the live subscription.`);
      else if (body.stripe?.noSubscription) setNote('Saved. No live subscription — nothing to discount; checkout is blocked while the plan is free.');
      onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        {active.length === 0 && <span className="text-gray-300">—</span>}
        {active.map((b) => (
          <span key={b.badge} title={`${b.rights}${b.justification ? `\nWhy: ${b.justification}` : ''}\nGranted ${formatDate(b.grantedAt)}`}
            className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${b.lapsedAt ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-cyan-200 bg-cyan-50 text-cyan-900'}`}>
            <PlatformBadgeIcon badge={b.badge} size={14} />
            {b.label}
            {b.lapsedAt && ' · lapsed'}
            {b.window && !b.lapsedAt && b.window.elapsedPct >= 75 && ` · ${b.window.daysLeft}d left`}
            {b.id && (
              <button onClick={() => { setMode({ revoke: b }); setReason(''); }} className="ml-0.5 text-gray-400 hover:text-[#B00000]" title="Revoke…">×</button>
            )}
          </span>
        ))}
        {mode === 'idle' && active.length < MANUAL_BADGES.length && (
          <button onClick={() => { setMode('grant'); setJustification(''); setFreeUntil(''); setBadge(active.some((b) => b.badge === 'tech_master') ? 'pioneer' : 'tech_master'); }}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-600 hover:bg-gray-50">Grant…</button>
        )}
      </div>

      {mode === 'grant' && (
        <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2">
          <div className="flex items-center gap-1.5">
            <select value={badge} onChange={(e) => setBadge(e.target.value as PlatformBadgeKey)} className="rounded border border-gray-300 px-1.5 py-0.5">
              {MANUAL_BADGES.filter((b) => !active.some((a) => a.badge === b)).map((b) => <option key={b} value={b}>{BADGE_LABEL[b]}</option>)}
            </select>
            <span className="text-gray-500">{BADGE_SHORT[badge]}</span>
          </div>
          <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2}
            placeholder={`Why ${orgName} — which cohort, agreed with whom (required, audited)`}
            className="w-full rounded border border-gray-300 px-1.5 py-1" />
          {badge === 'pioneer' && (
            <label className="flex items-center gap-1.5 text-gray-600">
              Free until
              <input type="date" value={freeUntil} onChange={(e) => setFreeUntil(e.target.value)} autoComplete="off" className="rounded border border-gray-300 px-1.5 py-0.5" />
              <span className="text-gray-400">(optional — the offer period; after it, 25% off forever)</span>
            </label>
          )}
          <div className="flex items-center gap-1.5">
            <button disabled={busy || justification.trim().length < 8}
              onClick={async () => { if (await post({ action: 'grant', orgId, badge, justification, freeUntil: freeUntil || null })) setMode('idle'); }}
              className="rounded bg-[#0E7490] px-2 py-1 font-medium text-white disabled:opacity-40">{busy ? 'Saving…' : `Grant ${BADGE_LABEL[badge]}`}</button>
            <button onClick={() => setMode('idle')} className="rounded border border-gray-300 px-2 py-1 text-gray-600">Cancel</button>
          </div>
        </div>
      )}

      {typeof mode === 'object' && (
        <div className="space-y-1.5 rounded-lg border border-red-200 bg-red-50 p-2">
          <p className="text-red-900">Revoke <b>{mode.revoke.label}</b> from {orgName}? The rights stop at once; a live Stripe discount is removed.</p>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, audited)" autoComplete="off" className="w-full rounded border border-gray-300 px-1.5 py-1" />
          <div className="flex items-center gap-1.5">
            <button disabled={busy || reason.trim().length < 4}
              onClick={async () => { if (await post({ action: 'revoke', id: mode.revoke.id, reason })) setMode('idle'); }}
              className="rounded bg-[#B00000] px-2 py-1 font-medium text-white disabled:opacity-40">{busy ? 'Revoking…' : 'Revoke'}</button>
            <button onClick={() => setMode('idle')} className="rounded border border-gray-300 px-2 py-1 text-gray-600">Cancel</button>
          </div>
        </div>
      )}

      {err && <p className="text-[#B00000]">{err}</p>}
      {note && <p className="text-gray-500">{note}</p>}
    </div>
  );
}
