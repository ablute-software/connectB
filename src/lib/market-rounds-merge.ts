// Prompt 447 §D.2 — merges the two sources "Comparable rounds" can now
// come from: a tracked competitor's own known funding history
// (investor_investments), and an accepted `rounds` research item (445's
// RoundStructured). Pure, no network calls.
export interface MergedRound {
  companyName: string; investorName: string | null; amountEur: number | null; investedAt: string | null;
  // Prompt 481 — 'manual' joins the two sources 447 §D.2 established.
  // Kept as this one union (re-exported as CapitalRoundSource in
  // capital-landscape.ts) so the warning a row carries is decided from the
  // same field the merge sorts on — never a second, drifting notion of
  // where a round came from.
  roundType: string | null; source: 'competitor_tracked' | 'research' | 'manual';
}

// Dedupe by (normalized name, amount) — the same round found through both
// paths (a tracked competitor whose funding the research also found)
// appears once, preferring the 'competitor_tracked' version (already
// linked to the competitor card) when both exist.
export function mergeComparableRounds(tracked: MergedRound[], researched: MergedRound[], manual: MergedRound[] = []): MergedRound[] {
  const key = (r: MergedRound) => `${r.companyName.trim().toLowerCase()}|${r.amountEur ?? ''}`;
  const seen = new Set(tracked.map(key));
  const extra = researched.filter((r) => !seen.has(key(r)));
  // Prompt 481 — the founder's own entries are added LAST but are never
  // deduped away against the other two. A founder who deliberately typed a
  // round they know about must still see it, even when the platform also
  // found something that looks like it: silently swallowing a founder's
  // entry into a platform row would also silently swap the warning it
  // carries, which §5 forbids. Duplicates here are visible and explicable;
  // a disappeared manual entry is neither.
  return [...tracked, ...extra, ...manual].sort((a, b) => (b.investedAt ?? '').localeCompare(a.investedAt ?? ''));
}
