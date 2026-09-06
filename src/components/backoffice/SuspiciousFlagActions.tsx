'use client';
// Prompt 244/245 — the actions for one Suspicious Accounts flag.
// Prompt 574 §B.3 — Suspend/Delete now go through AccountActionPanel (the
// Fase 3 side panel, generalized by Prompt 580 specifically so this
// migration wouldn't need a second panel built for it — checked directly:
// its own header comment already names "the Suspicious Accounts queue in a
// later phase" as the reason it took an onConfirm callback instead of a
// hardcoded endpoint). Same real routes underneath
// (/api/backoffice/suspicious-flags/[id]/{suspend,delete-and-block}), same
// applyModerationAction() state machine those already called — this is a
// UI-layer migration, not a new backend behavior. Alert email and the new
// Dismiss stay their own small inline flows: alert_email isn't destructive
// (AccountActionPanel's own scope is Suspend/Delete only), and Dismiss has
// no moderation cascade to preview at all — there's nothing it removes.
import { useState } from 'react';
import { AccountActionPanel } from './AccountActionPanel';
import { moderationCascadeLines } from '@/lib/moderation-cascade-copy';
import type { ModerationTargetType } from '@/lib/account-moderation';

type Mode = 'alert_email' | 'dismiss';
type SuspendPanel = { hours: number; label: string } | null;

const SUSPEND_PRESETS = [
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: 'Indefinite', hours: null as number | null },
];

export function SuspiciousFlagActions({ flagId, targetType, companyName, hasEmail, onChanged }: {
  flagId: string; targetType: ModerationTargetType; companyName: string; hasEmail: boolean; onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [suspendPanel, setSuspendPanel] = useState<SuspendPanel>(null);
  const [deletePanel, setDeletePanel] = useState(false);
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function cancel() { setMode(null); setJustification(''); setErr(''); }

  async function submitAlertEmail() {
    setBusy(true); setErr('');
    const res = await fetch(`/api/backoffice/suspicious-flags/${flagId}/alert-email`, { method: 'POST' });
    const body = await res.json();
    setBusy(false);
    if (!body.ok) { setErr(body.error); return; }
    cancel(); onChanged();
  }

  async function submitDismiss() {
    if (!justification.trim()) { setErr('A reason is required.'); return; }
    setBusy(true); setErr('');
    const res = await fetch(`/api/backoffice/suspicious-flags/${flagId}/dismiss`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: justification }),
    });
    const body = await res.json();
    setBusy(false);
    if (!body.ok) { setErr(body.error); return; }
    cancel(); onChanged();
  }

  const panel = (suspendPanel || deletePanel) && (
    <AccountActionPanel
      title={suspendPanel ? 'Suspend' : 'Delete'} name={companyName}
      cascadeLines={moderationCascadeLines(targetType)}
      confirmLabel={suspendPanel ? `Confirm suspend (${suspendPanel.label})` : 'Confirm delete'}
      reasonPlaceholder="Why is this account being suspended/deleted?"
      onConfirm={async (reason) => {
        const url = suspendPanel
          ? `/api/backoffice/suspicious-flags/${flagId}/suspend`
          : `/api/backoffice/suspicious-flags/${flagId}/delete-and-block`;
        const body = suspendPanel
          ? JSON.stringify({ hours: suspendPanel.hours, justification: reason })
          : JSON.stringify({ justification: reason });
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        const resBody = await res.json().catch(() => ({}));
        return { ok: !!resBody.ok, error: resBody.error };
      }}
      onClose={() => { setSuspendPanel(null); setDeletePanel(false); }}
      onDone={() => { setSuspendPanel(null); setDeletePanel(false); onChanged(); }} />
  );

  if (mode === 'alert_email') {
    return (
      <>
      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-gray-500">Sends a generic &quot;unusual activity&quot; notice to the email on file. Wording isn&apos;t final yet.</p>
        {err && <span className="text-[11px] text-[#B00000]">{err}</span>}
        <div className="flex gap-1.5">
          <button disabled={busy} onClick={() => void submitAlertEmail()}
            className="rounded bg-[#0E7490] px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40">
            {busy ? 'Sending…' : 'Confirm send'}
          </button>
          <button onClick={cancel} className="rounded border border-gray-300 px-2 py-0.5 text-[11px]">Cancel</button>
        </div>
      </div>
      {panel}
      </>
    );
  }

  if (mode === 'dismiss') {
    return (
      <>
      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-gray-500">Marks this flag reviewed — not suspicious, or not enough to act on. No moderation change.</p>
        <textarea value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Reason (required)"
          rows={2} className="w-56 rounded border border-gray-200 p-1 text-xs" />
        {err && <span className="text-[11px] text-[#B00000]">{err}</span>}
        <div className="flex gap-1.5">
          <button disabled={busy} onClick={() => void submitDismiss()}
            className="rounded bg-gray-600 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40">
            {busy ? 'Saving…' : 'Confirm dismiss'}
          </button>
          <button onClick={cancel} className="rounded border border-gray-300 px-2 py-0.5 text-[11px]">Cancel</button>
        </div>
      </div>
      {panel}
      </>
    );
  }

  return (
    <>
    <div className="flex flex-wrap gap-2">
      <button disabled={!hasEmail} title={hasEmail ? undefined : 'No email on file'}
        onClick={() => setMode('alert_email')} className="text-xs text-[#0E7490] hover:underline disabled:text-gray-300 disabled:no-underline">
        Send alert email
      </button>
      {SUSPEND_PRESETS.map((p) => (
        <button key={p.label} onClick={() => setSuspendPanel({ hours: p.hours ?? 24 * 365 * 10, label: p.label })}
          className="text-xs text-amber-700 hover:underline">
          Suspend ({p.label})
        </button>
      ))}
      <button disabled={!hasEmail} title={hasEmail ? undefined : 'No email on file to block'}
        onClick={() => setDeletePanel(true)} className="text-xs text-[#B00000] hover:underline disabled:text-gray-300 disabled:no-underline">
        Delete + block email
      </button>
      <button onClick={() => setMode('dismiss')} className="text-xs text-gray-500 hover:underline">Dismiss…</button>
    </div>
    {panel}
    </>
  );
}
