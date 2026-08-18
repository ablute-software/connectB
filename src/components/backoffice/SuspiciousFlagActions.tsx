'use client';
// Prompt 244/245 — the three actions for one Suspicious Accounts flag.
// Same "confirm-then-justify inline" pattern as ModerationControls.tsx
// (suspend/delete already require this for the plain Startups/Investors
// flow) — a second explicit click plus a non-empty justification before
// anything fires. Alert email doesn't need a justification (it isn't a
// moderation action, just a notice), but still requires the confirm click.
import { useState } from 'react';

type Mode = 'alert_email' | 'suspend' | 'delete_and_block';

const SUSPEND_PRESETS = [
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
];

export function SuspiciousFlagActions({ flagId, hasEmail, onChanged }: {
  flagId: string; hasEmail: boolean; onChanged: () => void;
}) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [hours, setHours] = useState(24);
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

  async function submitSuspend() {
    if (!justification.trim()) { setErr('Justification is required.'); return; }
    setBusy(true); setErr('');
    const res = await fetch(`/api/backoffice/suspicious-flags/${flagId}/suspend`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hours, justification }),
    });
    const body = await res.json();
    setBusy(false);
    if (!body.ok) { setErr(body.error); return; }
    cancel(); onChanged();
  }

  async function submitDeleteAndBlock() {
    if (!justification.trim()) { setErr('Justification is required.'); return; }
    setBusy(true); setErr('');
    const res = await fetch(`/api/backoffice/suspicious-flags/${flagId}/delete-and-block`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ justification }),
    });
    const body = await res.json();
    setBusy(false);
    if (!body.ok) { setErr(body.error); return; }
    cancel(); onChanged();
  }

  if (mode === 'alert_email') {
    return (
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
    );
  }

  if (mode === 'suspend') {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap gap-1">
          {SUSPEND_PRESETS.map((p) => (
            <button key={p.hours} onClick={() => setHours(p.hours)}
              className={`rounded-full px-2 py-0.5 text-[11px] ${hours === p.hours ? 'bg-[#0E7490] text-white' : 'bg-gray-100 text-gray-600'}`}>
              {p.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1 text-[11px] text-gray-500">
          or custom hours:
          <input type="number" min={1} value={hours} onChange={(e) => setHours(Number(e.target.value))}
            className="w-20 rounded border border-gray-200 px-1 py-0.5 text-[11px]" />
        </label>
        <textarea value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Justification (required)"
          rows={2} className="w-56 rounded border border-gray-200 p-1 text-xs" />
        {err && <span className="text-[11px] text-[#B00000]">{err}</span>}
        <div className="flex gap-1.5">
          <button disabled={busy} onClick={() => void submitSuspend()}
            className="rounded bg-amber-600 px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40">
            {busy ? 'Saving…' : `Confirm suspend (${hours}h)`}
          </button>
          <button onClick={cancel} className="rounded border border-gray-300 px-2 py-0.5 text-[11px]">Cancel</button>
        </div>
      </div>
    );
  }

  if (mode === 'delete_and_block') {
    return (
      <div className="flex flex-col gap-1">
        <p className="text-[11px] text-[#B00000]">
          Deletes immediately (bypasses the usual 30-day quarantine — recorded as such) and blocks this email from
          signing up, being invited, or being granted access again anywhere on the platform.
        </p>
        <textarea value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Justification (required)"
          rows={2} className="w-56 rounded border border-gray-200 p-1 text-xs" />
        {err && <span className="text-[11px] text-[#B00000]">{err}</span>}
        <div className="flex gap-1.5">
          <button disabled={busy} onClick={() => void submitDeleteAndBlock()}
            className="rounded bg-[#B00000] px-2 py-0.5 text-[11px] font-semibold text-white disabled:opacity-40">
            {busy ? 'Saving…' : 'Confirm delete + block'}
          </button>
          <button onClick={cancel} className="rounded border border-gray-300 px-2 py-0.5 text-[11px]">Cancel</button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button disabled={!hasEmail} title={hasEmail ? undefined : 'No email on file'}
        onClick={() => setMode('alert_email')} className="text-xs text-[#0E7490] hover:underline disabled:text-gray-300 disabled:no-underline">
        Send alert email
      </button>
      <button onClick={() => setMode('suspend')} className="text-xs text-amber-700 hover:underline">Suspend…</button>
      <button disabled={!hasEmail} title={hasEmail ? undefined : 'No email on file to block'}
        onClick={() => setMode('delete_and_block')} className="text-xs text-[#B00000] hover:underline disabled:text-gray-300 disabled:no-underline">
        Delete + block email
      </button>
    </div>
  );
}
