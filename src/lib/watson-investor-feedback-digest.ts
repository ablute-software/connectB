// Prompt 349 — Chamber 3: the k-anonymous aggregate (k>=3). Pure logic only.
export const MIN_CONTRIBUTORS = 3;

export interface ScoreStats { avg: number; min: number; max: number }

// Simplification, documented: investor_scorecard_criteria are each
// investor's own custom-labeled criteria (never a standardized taxonomy
// across firms), so there is no common "criterion" to aggregate a
// distribution PER criterion the way a shared scale would allow. This
// aggregates each contributing investor's own weighted average into ONE
// number per investor, then summarizes that set — never exposing which
// investor produced which number.
export function computeScoreStats(perInvestorAverages: number[]): ScoreStats | null {
  if (perInvestorAverages.length === 0) return null;
  const avg = perInvestorAverages.reduce((s, n) => s + n, 0) / perInvestorAverages.length;
  return { avg: Math.round(avg * 10) / 10, min: Math.min(...perInvestorAverages), max: Math.max(...perInvestorAverages) };
}

// k-anonymity gate — the one rule this entire chamber exists to enforce:
// below MIN_CONTRIBUTORS, there is no digest, full stop. Never "not enough
// data yet (2/3)" — a count below the threshold is exactly the information
// k-anonymity exists to hide.
export function canPublishDigest(contributorCount: number): boolean {
  return contributorCount >= MIN_CONTRIBUTORS;
}

export const WATSON_FEEDBACK_DIGEST_SYSTEM =
  'You read a batch of PRIVATE notes venture investors wrote about ONE startup, each while scoring their own '
  + 'evaluation criteria. Extract up to 5 short, GENERAL themes that recur across multiple notes — never quote a '
  + 'note verbatim, never mention how many investors said something, never attribute anything to an identifiable '
  + 'investor or imply which note came from whom. If the notes don\'t actually share any common theme, return fewer '
  + '(even zero) rather than inventing one. A theme must be phrased as a general observation about the startup '
  + '("commercial execution comes up as a recurring concern"), never as a summary of what "investors said".';

export function buildFeedbackDigestPrompt(notes: string[]): string {
  return `Private investor notes (order is arbitrary, not attributable to any one investor):\n\n${
    notes.map((n, i) => `Note ${i + 1}: ${n}`).join('\n\n')}`;
}
