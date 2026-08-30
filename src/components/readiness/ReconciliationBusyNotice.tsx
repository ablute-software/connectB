'use client';
// Prompt 480 §6 — the founder-facing half of the org reconciliation lock.
//
// When a second run for the same org finds the lock held and gives up
// waiting, the response still arrives complete; only the freshness of the
// document-matching pass is missing. The founder is told that, once, in a
// notice that never blocks the page — they can keep working, and the panel
// behind this is fully usable.
//
// Deliberately NOT an error style: nothing failed. The most likely cause is
// the founder's own second tab (Prompt 480's own "cenário mais provável"),
// which is not a fault and must not look like one — the same reasoning
// Prompt 468 applied to the timeout message, and 471 §B to its colour.
//
// Shared by all four panels that can receive the flag rather than
// re-written in each: three get it from /api/blueprint's GET
// (reconciliationSkipped) and MarketDataPanel from
// /api/reconciliation/run's own response. One component, one wording — a
// notice that drifts between panels reads as four different bugs.
import { useEffect, useState } from 'react';

export const RECONCILIATION_BUSY_MESSAGE = 'We\'re checking your data for matches in another tab — this may take a few extra seconds. '
  + 'Refresh in a moment to see the latest.';

// Long enough to read without hunting for it, short enough that it never
// becomes furniture the founder learns to ignore.
const AUTO_DISMISS_MS = 12_000;

export function ReconciliationBusyNotice({ show }: { show: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!show) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), AUTO_DISMISS_MS);
    // Cleared on unmount so a founder who navigates away mid-countdown
    // doesn't leave a timer setting state on a component that's gone.
    return () => clearTimeout(t);
  }, [show]);

  if (!visible) return null;
  return (
    <div className="mb-2 flex items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-800">
      <span>{RECONCILIATION_BUSY_MESSAGE}</span>
      <button type="button" onClick={() => setVisible(false)}
        aria-label="Dismiss" className="shrink-0 font-medium text-amber-700 hover:underline">
        Dismiss
      </button>
    </div>
  );
}
