// Prompt 904 Part C (C5) — shown when an administrator took a person's seat away: their own account is
// intact, the firm's data stays with the firm, and the next time they enter they are told so BY NAME
// and shown the plans, instead of the "find your firm" form as if they had never belonged anywhere.
// There is no access by default (Prompt 559): with no active seat of their own nothing of the firm
// resolves for them, which is what the unlinked state of the workspace already means.
export function RemovedFromFirmNotice({ firmName, onSeePlans }: { firmName: string; onSeePlans?: () => void }) {
  return (
    <div role="status" data-testid="removed-from-firm" className="mb-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-bold text-amber-900">You&apos;re no longer part of {firmName}</p>
      <p className="mt-1 text-xs text-amber-800">
        Your own account is untouched, and {firmName}&apos;s data stays with {firmName}. To keep using Sherlock Deal on your
        own, pick a plan below, or ask {firmName}&apos;s administrator to reserve a seat for you again.
      </p>
      {onSeePlans && (
        <button type="button" onClick={onSeePlans}
          className="mt-2 rounded-lg bg-amber-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-800">See plans</button>
      )}
    </div>
  );
}
