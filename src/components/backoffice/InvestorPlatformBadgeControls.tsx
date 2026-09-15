'use client';
// Prompt 703 §4 — the investor-firm equivalent of PlatformBadgeControls.tsx
// (Startups table), same menu/justification requirement, so the two lists
// stay symmetric as asked. Simpler on purpose: no free-until date field (no
// Stripe coupon is ever applied here — see investor-platform-badges-server.ts)
// and no lapse display (no lapse sweep exists for investor badges).
import { useState } from 'react';
import { PlatformBadgeIcon } from '@/components/badges/PlatformBadgeIcon';
import { BADGE_LABEL, MANUAL_BADGES, formatDate, type PlatformBadgeKey } from '@/lib/platform-badges';

export interface AdminInvestorBadgeRow {
  id: string; catalogEntityId: string; badge: PlatformBadgeKey; label: string; rights: string;
  grantedAt: string; justification: string | null; revokedAt: string | null;
}

export function InvestorPlatformBadgeControls({ catalogEntityId, entityName, badges, onChanged }: {
  catalogEntityId: string; entityName: string; badges: AdminInvestorBadgeRow[]; onChanged: () => void;
}) {
  const [mode, setMode] = useState<'idle' | 'grant' | { revoke: AdminInvestorBadgeRow }>('idle');
  const [badge, setBadge] = useState<PlatformBadgeKey>('tech_master');
  const [justification, setJustification] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const active = badges.filter((b) => !b.revokedAt);

  async function post(payload: Record<string, unknown>) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/backoffice/investor-platform-badges', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await res.json();
      if (!body.ok) { setErr(body.error ?? 'Failed.'); return false; }
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
            className="inline-flex items-center gap-1 rounded-full border border-cyan-200 bg-cyan-50 px-1.5 py-0.5 text-cyan-900">
            <PlatformBadgeIcon badge={b.badge} size={14} />
            {b.label}
            <button onClick={() => { setMode({ revoke: b }); setReason(''); }} className="ml-0.5 text-gray-400 hover:text-[#B00000]" title="Revoke…">×</button>
          </span>
        ))}
        {mode === 'idle' && active.length < MANUAL_BADGES.length && (
          <button onClick={() => { setMode('grant'); setJustification(''); setBadge(active.some((b) => b.badge === 'tech_master') ? 'pioneer' : 'tech_master'); }}
            className="rounded border border-gray-300 px-1.5 py-0.5 text-gray-600 hover:bg-gray-50">Grant…</button>
        )}
      </div>

      {mode === 'grant' && (
        <div className="space-y-1.5 rounded-lg border border-gray-200 bg-gray-50 p-2">
          <select value={badge} onChange={(e) => setBadge(e.target.value as PlatformBadgeKey)} className="rounded border border-gray-300 px-1.5 py-0.5">
            {MANUAL_BADGES.filter((b) => !active.some((a) => a.badge === b)).map((b) => <option key={b} value={b}>{BADGE_LABEL[b]}</option>)}
          </select>
          <textarea value={justification} onChange={(e) => setJustification(e.target.value)} rows={2}
            placeholder={`Why ${entityName} — which cohort, agreed with whom (required, audited)`}
            className="w-full rounded border border-gray-300 px-1.5 py-1" />
          <div className="flex items-center gap-1.5">
            <button disabled={busy || justification.trim().length < 8}
              onClick={async () => { if (await post({ action: 'grant', catalogEntityId, badge, justification })) setMode('idle'); }}
              className="rounded bg-[#0E7490] px-2 py-1 font-medium text-white disabled:opacity-40">{busy ? 'Saving…' : `Grant ${BADGE_LABEL[badge]}`}</button>
            <button onClick={() => setMode('idle')} className="rounded border border-gray-300 px-2 py-1 text-gray-600">Cancel</button>
          </div>
        </div>
      )}

      {typeof mode === 'object' && (
        <div className="space-y-1.5 rounded-lg border border-red-200 bg-red-50 p-2">
          <p className="text-red-900">Revoke <b>{mode.revoke.label}</b> from {entityName}? The rights stop at once.</p>
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
    </div>
  );
}
