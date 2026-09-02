'use client';
// Prompt 107 — owner-controlled Visible/Suspended toggle, shared between
// the startup (settings/page.tsx) and investor (InvestorProfilePanel.tsx)
// "About" pages. Non-owners see the current state, disabled — never
// hidden, so a teammate who suddenly sees nothing in MatchDeal/pipelines
// has an actual explanation on screen instead of what reads as a bug.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { MatchdealMissingField, MatchdealStartupState } from '@/lib/matchdeal-publish';

const AWAY_REMINDER_MS = 30 * 24 * 60 * 60 * 1000;

export function VisibilityToggle({ kind }: { kind: 'startup' | 'investor' }) {
  const [status, setStatus] = useState<{
    isOwner: boolean; suspended: boolean; platformSuspended: boolean; suspendedAt: string | null; remindedAt: string | null;
    // Addenda to Prompt 120 (2026-08-04) — startup-only: whether the
    // profile is incomplete (distinct from suspended), and which fields
    // are missing. Confirmed live that a profile can be is_visible=false
    // purely from incompleteness, never suspended — this used to render
    // as the same green "Visible" badge as an actually-visible profile.
    // Prompt 543 §A — `state` replaces the old two-way isComplete guess.
    // missingFieldLinks carries the About-card anchor for each missing
    // field, so "Incomplete" can send the founder to the actual input.
    isComplete?: boolean; hasProfile?: boolean; missingFields?: string[];
    state?: MatchdealStartupState; missingFieldLinks?: MatchdealMissingField[];
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

  // Prompt 543 §A.2 — the act Prompt 125 requires and the product never
  // offered. Copies the org's own fields into the MatchDeal profile; the
  // trigger computes is_complete, which flips is_visible.
  async function publish() {
    setBusy(true); setErr('');
    try {
      const res = await fetch('/api/company/matchdeal/publish', { method: 'POST' });
      const b = await res.json().catch(() => null);
      if (!b?.ok) {
        setErr(b?.missingFields?.length
          ? `Still missing: ${(b.missingFields as MatchdealMissingField[]).map((m) => m.label).join(', ')}.`
          : (b?.error ?? 'Could not publish — try again.'));
        return;
      }
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

  // Addenda to Prompt 120 — incomplete is a THIRD state, distinct from
  // suspended: is_visible can be false purely because required fields are
  // missing, with nobody having suspended anything. Only meaningful for
  // kind='startup' (the investor side has no equivalent badge to correct
  // here — this addenda's finding was specifically about startup profiles).
  // Prompt 543 §A — four states now, from the server. The old `incomplete`
  // boolean collapsed "you are missing fields" and "you have not published"
  // into one screen that said neither, and whose missing list was always
  // empty because it was read off a profile row that did not exist.
  const state: MatchdealStartupState | null = kind === 'startup' ? (status.state ?? null) : null;
  const missingLinks = status.missingFieldLinks ?? [];
  const badgeLabel = state === 'incomplete' ? 'Incomplete' : state === 'unpublished' ? 'Not published yet' : 'Visible';
  const amber = state === 'incomplete' || state === 'unpublished';

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
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            status.suspended || amber ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800'}`}>
            {status.suspended ? 'Suspended' : badgeLabel}
          </span>
          {/* Prompt 543 §A.3 — the button the founder never had. Only in
              the 'unpublished' state: with fields still missing there is
              nothing to publish, and once published Suspend is the right
              control. */}
          {state === 'unpublished' && status.isOwner ? (
            <button disabled={busy} onClick={() => void publish()}
              className="rounded-lg bg-[#0E7490] px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
              Publish to MatchDeal
            </button>
          ) : status.isOwner && state !== 'incomplete' ? (
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

      {/* Prompt 543 §A.3 — the "…" is gone, and so is the link to /pair:
          the MatchDeal app cannot complete anything, and pointing there was
          half of the loop founders were stuck in. */}
      {state === 'unpublished' && (
        <div className="mt-1 w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Investors will see your company card in MatchDeal from now on. You can suspend at any time.
        </div>
      )}
      {state === 'incomplete' && (
        <div className="mt-1 w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Investors can&apos;t find you yet — your company profile still needs:{' '}
          {missingLinks.map((m, i) => (
            <span key={m.fieldId}>
              {i > 0 && ', '}
              <Link href={`/settings?flash=${m.fieldId}`} className="font-medium underline hover:no-underline">{m.label}</Link>
            </span>
          ))}
          .
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
