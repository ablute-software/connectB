// Prompt 447 §D.2 — merges the two sources "Comparable rounds" can now
// come from: a tracked competitor's own known funding history
// (investor_investments), and an accepted `rounds` research item (445's
// RoundStructured). Pure, no network calls.
export interface MergedRound {
  companyName: string; investorName: string | null; amountEur: number | null; investedAt: string | null;
  roundType: string | null; source: 'competitor_tracked' | 'research';
}

// Dedupe by (normalized name, amount) — the same round found through both
// paths (a tracked competitor whose funding the research also found)
// appears once, preferring the 'competitor_tracked' version (already
// linked to the competitor card) when both exist.
export function mergeComparableRounds(tracked: MergedRound[], researched: MergedRound[]): MergedRound[] {
  const key = (r: MergedRound) => `${r.companyName.trim().toLowerCase()}|${r.amountEur ?? ''}`;
  const seen = new Set(tracked.map(key));
  const extra = researched.filter((r) => !seen.has(key(r)));
  return [...tracked, ...extra].sort((a, b) => (b.investedAt ?? '').localeCompare(a.investedAt ?? ''));
}
