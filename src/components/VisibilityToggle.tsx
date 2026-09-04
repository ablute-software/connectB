'use client';
// Prompt 107 — owner-controlled Visible/Suspended toggle, shared between
// the startup (settings/page.tsx) and investor (InvestorProfilePanel.tsx)
// "About" pages. Non-owners see the current state, disabled — never
// hidden, so a teammate who suddenly sees nothing in MatchDeal/pipelines
// has an actual explanation on screen instead of what reads as a bug.
//
// Prompt 850 §B — for kind='startup' the control is now ALWAYS available to
// the owner, whatever the MatchDeal state. Before this it was offered only
// when the state was neither 'incomplete' nor 'unpublished', so a founder
// who had never published on MatchDeal — which after §A is most of them —
// could not opt out of investor pipelines at all, while being discoverable
// in them. It writes the same owner_suspended_at pair /api/company/
// visibility already dual-writes; no migration. Publishing on MatchDeal
// keeps its own button and its own sentence, and stops being the thing
// that decides discovery.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { MatchdealMissingField, MatchdealStartupState } from '@/lib/matchdeal-publish';
import { investorVisibilityCopy, type InvestorVisibilityState } from '@/lib/investor-visibility-state';

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
    // Prompt 850 §B — the investor-visibility answer, independent of
    // MatchDeal. gateMissingFieldLinks is the NINE-field profile gate's own
    // missing list (pipeline-unlock.ts), not orgMatchdealMissing's seven.
    investorVisibility?: InvestorVisibilityState;
    gateMissingFieldLinks?: MatchdealMissingField[];
    pipelineFirmCount?: number | null;
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
  const badgeLabel = state === 'incomplete' ? 'Incomplete' : state === 'unpublished' ? 'Not published yet' : 'Visible';
  const amber = state === 'incomplete' || state === 'unpublished';

  // Prompt 850 §B — for a startup, the badge and sentence describe INVESTOR
  // visibility (the gate + the founder's own switch), not MatchDeal
  // publication. The investor side keeps the old two-way badge: it has no
  // profile gate and no discovery pipeline of its own to be found in.
  const gateMissing = status.gateMissingFieldLinks ?? [];
  const investorCopy = kind === 'startup' && status.investorVisibility
    ? investorVisibilityCopy(status.investorVisibility, {
        missingCount: gateMissing.length, pipelineFirmCount: status.pipelineFirmCount ?? null,
      })
    : null;

  return (
    <div id="visibility-toggle" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2">
      {status.platformSuspended ? (
        <>
          <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">Suspended by the platform</span>
          <span className="text-xs text-gray-500">Contact support — this wasn&apos;t your choice.</span>
        </>
      ) : confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-700">
            {kind === 'startup'
              ? 'Hiding removes you from every investor discovery pipeline, and from MatchDeal. Existing relationships and access stay untouched.'
              : 'Suspending removes you from MatchDeal and discovery pipelines. Existing relationships and access stay untouched.'}
          </span>
          <button disabled={busy} onClick={() => setSuspended(true)} className="rounded-lg bg-[#B00000] px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
            {kind === 'startup' ? 'Confirm hide' : 'Confirm suspend'}
          </button>
          <button disabled={busy} onClick={() => setConfirming(false)} className="rounded-lg border border-gray-300 px-3 py-1 text-xs">Cancel</button>
        </div>
      ) : (
        <>
          <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            investorCopy
              ? (investorCopy.tone === 'ok' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800')
              : (status.suspended || amber ? 'bg-amber-100 text-amber-800' : 'bg-green-100 text-green-800')}`}>
            {investorCopy ? investorCopy.badge : (status.suspended ? 'Suspended' : badgeLabel)}
          </span>
          {/* Prompt 850 §B — the switch is ALWAYS here for the owner of a
              startup, whatever the MatchDeal state, because after §A this
              is the only thing that takes them out of investor pipelines.
              An incomplete profile keeps it too: nothing stops a founder
              from deciding up front that they do not want to be found. */}
          {status.isOwner && (kind === 'startup' || state !== 'incomplete') ? (
            <button disabled={busy}
              onClick={() => status.suspended ? void setSuspended(false) : setConfirming(true)}
              className="rounded-lg border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-40">
              {kind === 'startup'
                ? (status.suspended ? 'Make me visible to investors' : 'Hide me from investors')
                : (status.suspended ? 'Make visible again' : 'Suspend')}
            </button>
          ) : !status.isOwner ? (
            <span className="text-xs text-gray-400">Only the owner can change this.</span>
          ) : null}
          {/* Prompt 543 §A.2 — publishing the MatchDeal card is now its own
              act with its own name (Prompt 850 §B), separate from and no
              longer deciding investor discovery. Still only offered in the
              'unpublished' state: with MatchDeal fields missing there is
              nothing to publish. */}
          {state === 'unpublished' && status.isOwner && (
            <button disabled={busy} onClick={() => void publish()}
              className="rounded-lg bg-[#0E7490] px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
              Publish your card on MatchDeal
            </button>
          )}
        </>
      )}
      {err && <span className="text-xs text-[#B00000]">{err}</span>}

      {/* Prompt 850 §B — one sentence, from the shared copy, for whichever
          of the three states this startup is in. It replaces the two
          MatchDeal-shaped blocks below for kind='startup'; the investor
          side keeps its own suspended note. */}
      {investorCopy && !status.platformSuspended && (
        <div className={`mt-1 w-full rounded-lg px-3 py-2 text-xs ${
          investorCopy.tone === 'ok' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
          {investorCopy.detail}
          {status.investorVisibility === 'incomplete' && gateMissing.length > 0 && (
            <>
              {' '}Still needed:{' '}
              {gateMissing.map((m, i) => (
                <span key={m.fieldId}>
                  {i > 0 && ', '}
                  <Link href={`/settings?flash=${m.fieldId}`} className="font-medium underline hover:no-underline">{m.label}</Link>
                </span>
              ))}
              .
            </>
          )}
        </div>
      )}

      {!investorCopy && status.suspended && !status.platformSuspended && (
        <div className="mt-1 w-full rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Suspended — invisible in MatchDeal and discovery pipelines. Existing relationships and access are unaffected.
        </div>
      )}

      {/* Prompt 543 §A.3 — the "…" is gone, and so is the link to /pair:
          the MatchDeal app cannot complete anything, and pointing there was
          half of the loop founders were stuck in. Prompt 850 §B — this is
          now purely about the MatchDeal card, and says so: it no longer
          claims to be what makes investors able to find you. */}
      {state === 'unpublished' && !status.suspended && (
        <div className="mt-1 w-full rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
          Your card isn&apos;t on MatchDeal yet. That&apos;s the swipe app — separate from the investor pipelines above, and optional.
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
