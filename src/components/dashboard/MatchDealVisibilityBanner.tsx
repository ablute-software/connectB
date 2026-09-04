'use client';
// Addenda to Prompt 120 (2026-08-04) — the structural fix, not a data sync:
// a startup decides, informed, whether investors can find it; it doesn't
// get silently completed for them. Surfaced here (Dashboard, the founder's
// daily landing page) rather than only on Settings' VisibilityToggle,
// since that one's easy to never scroll to. Deliberately scoped to the
// not-yet-visible states, not owner-suspended — a founder who suspended on
// purpose already saw that decision when they clicked it; this banner is
// for the blind spot (invisible with nobody having chosen that).
//
// Prompt 543 §A.3 — this banner was half of a closed loop. It said
// "Missing: …" (a literal ellipsis: the list came from a matchdeal_profiles
// row that, for every org created since July, did not exist) and linked to
// "Complete it on the MatchDeal app", whose own no-profile screen linked
// back here. Now it names the real missing fields with links straight to
// them, or — when nothing is missing — offers the publish act itself.
//
// Prompt 850 §B — and it now answers the question the founder actually has,
// which after §A is no longer "am I on MatchDeal": it is "can investors find
// me". The three states come from the same shared copy the About badge uses
// (investor-visibility-state.ts), so the two surfaces cannot disagree, and
// the missing-field list is the NINE-field profile gate's — the one
// eligibility really reads — not orgMatchdealMissing's seven. Publishing the
// MatchDeal card keeps its button here, renamed for what it does, and is
// offered only once investors can already find the startup: it is an extra
// surface, never the thing standing between a founder and discovery.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { MatchdealMissingField, MatchdealStartupState } from '@/lib/matchdeal-publish';
import { investorVisibilityCopy, type InvestorVisibilityState } from '@/lib/investor-visibility-state';

export function MatchDealVisibilityBanner() {
  const [status, setStatus] = useState<{
    isComplete?: boolean; suspended?: boolean; platformSuspended?: boolean;
    state?: MatchdealStartupState; missingFieldLinks?: MatchdealMissingField[]; isOwner?: boolean;
    // Prompt 850 §B.
    investorVisibility?: InvestorVisibilityState;
    gateMissingFieldLinks?: MatchdealMissingField[];
    pipelineFirmCount?: number | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  function load() {
    fetch('/api/company/visibility?kind=startup', { cache: 'no-store' }).then((r) => r.json()).then((b) => {
      if (b.ok) setStatus(b);
    }).catch(() => {});
  }
  useEffect(load, []);

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

  if (!status) return null;
  // A platform suspension is not a founder-actionable banner — the About
  // card says what it is and who to contact. Unchanged from Prompt 120.
  if (status.platformSuspended) return null;
  const visibility = status.investorVisibility;
  if (!visibility) return null;
  const gateMissing = status.gateMissingFieldLinks ?? [];
  const copy = investorVisibilityCopy(visibility, {
    missingCount: gateMissing.length, pipelineFirmCount: status.pipelineFirmCount ?? null,
  });
  // Prompt 850 §B — the banner exists for the blind spot and for the one
  // remaining nudge. It says nothing when the founder is visible AND their
  // MatchDeal card is already up: there is nothing left to tell them, and
  // the Sherlock golden rule is that the product reduces perceived weight
  // rather than adding a permanent green sticker to the Dashboard.
  const showPublish = visibility === 'visible' && status.state === 'unpublished';
  if (visibility === 'visible' && !showPublish) return null;
  // A founder who hid themselves already saw that decision when they made
  // it — Prompt 120's own scoping, kept.
  if (visibility === 'hidden') return null;

  return (
    <div className={`rounded-lg border-l-4 px-4 py-3 text-sm ${
      copy.tone === 'ok' ? 'border-gray-300 bg-gray-50' : 'border-amber-500 bg-amber-50'}`}>
      {visibility === 'incomplete' ? (
        <>
          <span className="font-semibold text-amber-800">⚠ {copy.detail}</span>
          {gateMissing.length > 0 && (
            <span className="ml-1 text-amber-700">
              Still needed:{' '}
              {gateMissing.map((m, i) => (
                <span key={m.fieldId}>
                  {i > 0 && ', '}
                  <Link href={`/settings?flash=${m.fieldId}`} className="font-medium underline hover:no-underline">{m.label}</Link>
                </span>
              ))}
              .
            </span>
          )}
        </>
      ) : (
        <>
          <span className="font-semibold text-gray-800">{copy.detail}</span>
          <span className="ml-1 text-gray-600">
            Your card isn&apos;t on MatchDeal yet — that&apos;s the swipe app, an extra surface on top of the pipelines you&apos;re already in.
          </span>
          {status.isOwner && (
            <button disabled={busy} onClick={() => void publish()}
              className="ml-2 rounded-lg bg-[#0E7490] px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
              Publish your card on MatchDeal
            </button>
          )}
        </>
      )}
      {err && <span className="ml-2 text-xs text-[#B00000]">{err}</span>}
    </div>
  );
}
