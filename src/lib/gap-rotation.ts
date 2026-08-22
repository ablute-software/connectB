// Prompt 309 — "Skip this one" bug: dismissing a gap never writes a claim
// (blueprint/answer/route.ts's own comment: not answering isn't new
// knowledge), so the exact same gap kept coming back as gaps[0] on the next
// reload — Skip visibly did nothing. This is the presentation-only fix:
// pick the first gap NOT skipped this screen visit, and only fall back to
// showing a skipped one once every other remaining gap has also been
// skipped (the rotation restarts from the top, same fixed order
// detectGaps already returns) — never a persisted dismissal, never queried
// against the database. Shared by ReviewPanel.tsx and BlueprintPanel.tsx,
// which both drive the exact same GapInterrogation flow.
export function pickCurrentGap<T extends { key: string }>(gaps: T[], skippedKeys: ReadonlySet<string>): T | undefined {
  return gaps.find((g) => !skippedKeys.has(g.key)) ?? gaps[0];
}
