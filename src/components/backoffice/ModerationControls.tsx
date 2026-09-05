'use client';
// Prompt 123 Block C.2 — shared suspend/undo/delete controls for both the
// Startups and Investors backoffice tables (same flow, same routes, only
// targetType differs). Confirm-then-justify inline (not a separate modal
// library) — the "popup" the doc asks for is this inline confirm block,
// which already forces a second explicit click plus a non-empty
// justification before anything fires.
import { useState } from 'react';
import type { ModerationStatus, ModerationTargetType } from '@/lib/account-moderation';
import { moderationCascadeLines } from '@/lib/moderation-cascade-copy';
import { AccountActionPanel, type PanelAction } from './AccountActionPanel';

// 'undo' keeps this component's own inline confirm+justification flow — it
// is a recovery action, not a destructive one, and Fase 3's side panel
// (AccountActionPanel) is scoped to Suspend/Delete only.
type Mode = 'undo';

interface LatestAction { justification: string; actorEmail: string; createdAt: string }

export function ModerationControls({ targetType, targetId, name, status, quarantineUntil, onChanged }: {
  targetType: ModerationTargetType;
  targetId: string;
  /** Prompt 576 Fase 3 — the side panel needs something to put in its header. */
  name: string;
  status: ModerationStatus;
  quarantineUntil: string | null;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [panelAction, setPanelAction] = useState<PanelAction | null>(null);
  const [justification, setJustification] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [latest, setLatest] = useState<LatestAction | null | 'loading'>(null);

  async function submit(action: Mode) {
    if (!justification.trim()) { setErr('Justification is required.'); return; }
    setBusy(true); setErr('');
    const res = await fetch(`/api/backoffice/moderation/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetType, targetId, justification }),
    });
    const body = await res.json();
    setBusy(false);
    if (!body.ok) { setErr(body.error); return; }
    setMode(null); setJustification(''); setLatest(null);
    onChanged();
  }

  const panel = panelAction && (
    <AccountActionPanel targetType={targetType} targetId={targetId} name={name} action={panelAction}
      cascadeLines={moderationCascadeLines(targetType)}
      onClose={() => setPanelAction(null)}
      onDone={() => { setPanelAction(null); onChanged(); }} />
  );

  async function loadLatestJustification() {
    setLatest('loading');
    const res = await fetch(`/api/backoffice/moderation/history?targetType=${targetType}&targetId=${targetId}`);
    const body = await res.json();
    if (!body.ok) { setLatest(null); return; }
    const suspend = body.actions.find((a: { action: string }) => a.action === 'suspend');
    setLatest(suspend ? { justification: suspend.justification, actorEmail: suspend.actorEmail, createdAt: suspend.createdAt } : null);
  }

  if (status === 'deleted') return <><span className="text-xs text-gray-400">Deleted</span>{panel}</>;

  if (mode) {
    return (
      <>
      <div className="flex flex-col gap-1">
        <textarea value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Justification (required)"
          rows={2} className="w-48 rounded border border-gray-200 p-1 text-xs" />
        {err && <span className="text-[11px] text-[#B00000]">{err}</span>}
        <div className="flex gap-1.5">
          <button disabled={busy} onClick={() => void submit(mode)}
            className="rounded bg-[#B00000] px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40">
            {busy ? 'Saving…' : `Confirm ${mode}`}
          </button>
          <button onClick={() => { setMode(null); setErr(''); }} className="rounded border border-gray-300 px-2 py-0.5 text-[11px]">Cancel</button>
        </div>
      </div>
      {panel}
      </>
    );
  }

  if (status === 'active') {
    // Prompt 569 §0 — the path to deletion is now stated, not hidden.
    //
    // Deleting an account has existed since Prompt 123 C.2 (soft: it sets
    // moderation_status='deleted' and drops no row, with a justification the
    // API requires, not just the form). But an ACTIVE account only ever
    // rendered "Suspend", so from the screen there was no way to know deletion
    // existed at all — which is what the back-office review read as a missing
    // feature. The gate itself is deliberate and stays exactly as it is:
    // suspend, then a 30-day quarantine, enforced in canDelete rather than by
    // a disabled button. Saying so costs one line and removes the guesswork.
    return (
      <>
      <div className="flex flex-col gap-0.5">
        <button onClick={() => setPanelAction('suspend')} className="text-left text-xs text-[#B00000] hover:underline">Suspend</button>
        <span className="text-[10px] leading-tight text-gray-400">
          {/* Prompt 571 — the second sentence is the one that was missing: until
              0315, suspending closed the login and left the account sitting in
              every investor's deck. */}
          Suspending removes the account from investor discovery and pipelines
          while it lasts. To delete: suspend first, then delete after the
          30-day quarantine.
        </span>
      </div>
      {panel}
      </>
    );
  }

  const quarantineActive = !!quarantineUntil && new Date(quarantineUntil) > new Date();
  return (
    <>
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-amber-700">
        {quarantineActive ? `Quarantine until ${new Date(quarantineUntil!).toLocaleDateString()}` : 'Quarantine elapsed'}
      </span>
      {latest === null && (
        <button onClick={() => void loadLatestJustification()} className="text-left text-[11px] text-gray-400 hover:underline">Justification</button>
      )}
      {latest === 'loading' && <span className="text-[11px] text-gray-400">Loading…</span>}
      {latest && latest !== 'loading' && (
        <div className="rounded bg-amber-50 p-1.5 text-[11px] text-amber-900">
          <div>{latest.justification}</div>
          <div className="mt-0.5 text-amber-600">{latest.actorEmail} · {new Date(latest.createdAt).toLocaleString()}</div>
        </div>
      )}
      <div className="flex gap-1.5">
        <button onClick={() => setMode('undo')} className="text-xs text-[#0E7490] hover:underline">Undo</button>
        <button disabled={quarantineActive} onClick={() => setPanelAction('delete')}
          title={quarantineActive ? 'Wait for the 30-day quarantine to elapse' : undefined}
          className="text-xs text-[#B00000] hover:underline disabled:text-gray-300 disabled:no-underline">
          Delete
        </button>
      </div>
      {/* Prompt 569 §0 — a disabled button with only a title attribute reads as
          "broken" rather than "not yet": the reason was invisible on touch and
          to anyone who does not hover. */}
      {quarantineActive && (
        <span className="text-[10px] leading-tight text-gray-400">
          Delete unlocks when the quarantine elapses.
        </span>
      )}
    </div>
    {panel}
    </>
  );
}
