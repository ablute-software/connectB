'use client';
// Prompt 107 — owner-controlled Visible/Suspended toggle, shared between
// the startup (settings/page.tsx) and investor (InvestorProfilePanel.tsx)
// "About" pages. Non-owners see the current state, disabled — never
// hidden, so a teammate who suddenly sees nothing in MatchDeal/pipelines
// has an actual explanation on screen instead of what reads as a bug.
import { useEffect, useState } from 'react';

const AWAY_REMINDER_MS = 30 * 24 * 60 * 60 * 1000;

export function VisibilityToggle({ kind }: { kind: 'startup' | 'investor' }) {
  const [status, setStatus] = useState<{
    isOwner: boolean; suspended: boolean; platformSuspended: boolean; suspendedAt: string | null; remindedAt: string | null;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [showReminder, setShowReminder] = useState(false);

  function load() {
    fetch(`/api/company/visibility?kind=${kind}`, { cache: 'no-store' }).then((r) => r.json()).then((b) => {
      if (!b.ok) return;
      setStatus(b);
      if (b.suspended && b.isOwner) {
        const since = Date.parse(b.remindedAt ?? b.suspendedAt);
        setShowReminder(Date.now() - since > AWAY_REMINDER_MS);
      }
    }).catch(() => {});
  }
  useEffect(load, [kind]);

  async function setSuspended(next: boolean) {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/company/visibility', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ suspended: next, kind }),
      });
      const b = await res.json();
      if (!b.ok) { setErr(b.error ?? 'Failed.'); return; }
      setConfirming(false);
      load();
    } finally { setBusy(false); }
  }

  async function dismissReminder() {
    setShowReminder(false);
    await fetch('/api/company/visibility', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, markReminded: true }),
    }).catch(() => {});
  }

  function scrollToToggle() {
    document.getElementById('visibility-toggle')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  if (!status) return null;

  return (
    <div id="visibility-toggle" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
      {status.platformSuspended ? (
        <>
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">Suspended by the platform</span>
          <span className="text-xs text-gray-500">Contact support — this wasn&apos;t your choice.</span>
        </>
      ) : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-700">Suspending removes you from MatchDeal and discovery pipelines. Existing relationships and access stay untouched.</span>
          <button disabled={busy} onClick={() => setSuspended(true)} className="rounded-lg bg-[#B00000] px-3 py-1 text-xs font-medium text-white disabled:opacity-40">Confirm suspend</button>
          <button disabled={busy} onClick={() => setConfirming(false)} className="rounded-lg border border-gray-300 px-3 py-1 text-xs">Cancel</button>
        </div>
      ) : (
        <>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${status.suspended ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
            {status.suspended ? 'Suspended' : 'Visible'}
          </span>
          {status.isOwner ? (
            <button disabled={busy}
              onClick={() => status.suspended ? void setSuspended(false) : setConfirming(true)}
              className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              {status.suspended ? 'Make visible again' : 'Suspend'}
            </button>
          ) : (
            <span className="text-xs text-gray-400">Only the owner can change this.</span>
          )}
        </>
      )}
      {err && <span className="text-xs text-[#B00000]">{err}</span>}

      {status.suspended && !status.platformSuspended && (
        <div className="mt-1 w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Suspended — invisible in MatchDeal and discovery pipelines. Existing relationships and access are unaffected.
        </div>
      )}

      {showReminder && status.isOwner && (
        <div className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs text-gray-700">
          You&apos;ve been suspended for a while — still want that?
          <button onClick={scrollToToggle} className="ml-2 font-medium text-[#0E7490] hover:underline">Change it</button>
          <button onClick={dismissReminder} className="ml-2 text-gray-400 hover:text-gray-600">Dismiss</button>
        </div>
      )}
    </div>
  );
}
