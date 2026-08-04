'use client';
// Addenda to Prompt 120 (2026-08-04) — the structural fix, not a data sync:
// a startup decides, informed, whether investors can find it; it doesn't
// get silently completed for them. Surfaced here (Dashboard, the founder's
// daily landing page) rather than only on Settings' VisibilityToggle,
// since that one's easy to never scroll to. Deliberately scoped to
// INCOMPLETE only, not owner-suspended — a founder who suspended on
// purpose already saw that decision when they clicked it; this banner is
// for the blind spot (invisible with nobody having chosen that).
import { useEffect, useState } from 'react';

export function MatchDealVisibilityBanner() {
  const [status, setStatus] = useState<{ isComplete?: boolean; suspended?: boolean; platformSuspended?: boolean; missingFields?: string[] } | null>(null);

  useEffect(() => {
    fetch('/api/company/visibility?kind=startup', { cache: 'no-store' }).then((r) => r.json()).then((b) => {
      if (b.ok) setStatus(b);
    }).catch(() => {});
  }, []);

  if (!status || status.suspended || status.platformSuspended || status.isComplete) return null;

  return (
    <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm">
      <span className="font-semibold text-amber-800">⚠ Your MatchDeal profile is incomplete — investors can&apos;t find you.</span>
      <span className="ml-1 text-amber-700">
        Missing: {(status.missingFields ?? []).join(', ') || '…'}.{' '}
        <a href="/pair" className="font-medium underline hover:no-underline">Complete it on the MatchDeal app</a>.
      </span>
    </div>
  );
}
