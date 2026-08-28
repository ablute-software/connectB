'use client';
// Prompt 421 §G — investigated first, per the prompt's own instruction:
// matchdeal_pairings (migration 0075) does NOT record startup<->investor
// connections — its own consume flow (matchdeal-pairing.ts's
// consumePairingToken) shows it's DEVICE pairing (linking a phone to this
// investor's own MatchDeal session via QR), one active row per (firm,
// kind), no counterparty field at all. Actual startup connections would be
// matchdeal_matches, which this route does not query — building that
// history view is a real, separate piece of work this prompt's own
// fallback explicitly allows skipping: "if there's nothing useful, a
// short explanation + the existing QR entry point is enough, don't invent
// new functionality." MatchDeal stays deliberately off the investor nav
// (existing decision, untouched) — the QR pairing is reached from the
// header's own MatchDeal button, not duplicated here.
export function MatchDealHistoryTab() {
  return (
    <div className="max-w-2xl space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h2 className="text-sm font-semibold text-gray-900">MatchDeal</h2>
        <p className="mt-2 text-xs text-gray-600">
          MatchDeal is Sherlock Deal&apos;s in-person swipe deck — pull up your deal flow on your phone at an event
          and swipe through startups face to face.
        </p>
        <p className="mt-2 text-xs text-gray-600">
          To connect your phone, use the <b>MatchDeal</b> button in the header — it shows a QR code your phone scans
          to pair instantly.
        </p>
      </div>
    </div>
  );
}
