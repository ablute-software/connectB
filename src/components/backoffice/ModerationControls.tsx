'use client';
// Prompt 123 Block C.2 — shared suspend/undo/delete controls for both the
// Startups and Investors backoffice tables (same flow, same routes, only
// targetType differs). Confirm-then-justify inline (not a separate modal
// library) — the "popup" the doc asks for is this inline confirm block,
// which already forces a second explicit click plus a non-empty
// justification before anything fires.
import { useState } from 'react';
import type { ModerationStatus, ModerationTargetType } from '@/lib/account-moderation';

type Mode = 'suspend' | 'undo' | 'delete';

interface LatestAction { justification: string; actorEmail: string; createdAt: string }

export function ModerationControls({ targetType, targetId, status, quarantineUntil, onChanged }: {
  targetType: ModerationTargetType;
  targetId: string;
  status: ModerationStatus;
  quarantineUntil: string | null;
  onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
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

  async function loadLatestJustification() {
    setLatest('loading');
    const res = await fetch(`/api/backoffice/moderation/history?targetType=${targetType}&targetId=${targetId}`);
    const body = await res.json();
    if (!body.ok) { setLatest(null); return; }
    const suspend = body.actions.find((a: { action: string }) => a.action === 'suspend');
    setLatest(suspend ? { justification: suspend.justification, actorEmail: suspend.actorEmail, createdAt: suspend.createdAt } : null);
  }

  if (status === 'deleted') return <span className="text-xs text-gray-400">Deleted</span>;

  if (mode) {
    return (
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
    );
  }

  if (status === 'active') {
    return <button onClick={() => setMode('suspend')} className="text-xs text-[#B00000] hover:underline">Suspend</button>;
  }

  const quarantineActive = !!quarantineUntil && new Date(quarantineUntil) > new Date();
  return (
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
        <button disabled={quarantineActive} onClick={() => setMode('delete')}
          title={quarantineActive ? 'Wait for the 30-day quarantine to elapse' : undefined}
          className="text-xs text-[#B00000] hover:underline disabled:text-gray-300 disabled:no-underline">
          Delete
        </button>
      </div>
    </div>
  );
}
