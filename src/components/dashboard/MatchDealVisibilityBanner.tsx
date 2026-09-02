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
import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { MatchdealMissingField, MatchdealStartupState } from '@/lib/matchdeal-publish';

export function MatchDealVisibilityBanner() {
  const [status, setStatus] = useState<{
    isComplete?: boolean; suspended?: boolean; platformSuspended?: boolean;
    state?: MatchdealStartupState; missingFieldLinks?: MatchdealMissingField[]; isOwner?: boolean;
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

  if (!status || status.suspended || status.platformSuspended) return null;
  const state = status.state;
  if (state !== 'incomplete' && state !== 'unpublished') return null;

  return (
    <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm">
      {state === 'unpublished' ? (
        <>
          <span className="font-semibold text-amber-800">Your company isn&apos;t published to MatchDeal yet.</span>
          <span className="ml-1 text-amber-700">
            Investors will see your company card in MatchDeal from now on. You can suspend at any time.
          </span>
          {status.isOwner && (
            <button disabled={busy} onClick={() => void publish()}
              className="ml-2 rounded-lg bg-[#0E7490] px-3 py-1 text-xs font-medium text-white disabled:opacity-40">
              Publish to MatchDeal
            </button>
          )}
        </>
      ) : (
        <>
          <span className="font-semibold text-amber-800">⚠ Investors can&apos;t find you yet.</span>
          <span className="ml-1 text-amber-700">
            Your company profile still needs:{' '}
            {(status.missingFieldLinks ?? []).map((m, i) => (
              <span key={m.fieldId}>
                {i > 0 && ', '}
                <Link href={`/settings?flash=${m.fieldId}`} className="font-medium underline hover:no-underline">{m.label}</Link>
              </span>
            ))}
            .
          </span>
        </>
      )}
      {err && <span className="ml-2 text-xs text-[#B00000]">{err}</span>}
    </div>
  );
}
