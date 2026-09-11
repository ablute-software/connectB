// Prompt 659 — the Pipeline's three-step temperature marker (Nuno's decision,
// 2026-09-11). Recency of the last real touch, nothing else: warm within
// WARM_DAYS, cooling within COOLING_DAYS, cold beyond, and no marker at all for
// an investor never contacted. A two-step (warm / not) marker went dark on the
// real data — 0 of ablute_'s 58 contacted investors were touched inside 14 days,
// 15 were 15–60 days and 41 older — so three steps keep the screen honest
// without a marker that never lights. This is temperature (recency); "interest"
// is a separate ★ marker, and hot (meeting/diligence) is a stage signal — see
// the temperature rule documented on relationshipSummary (Prompt 657).
export const WARM_DAYS = 14; // matches rules.ts LOCK_DAYS — a live conversation
export const COOLING_DAYS = 60;

export type Temperature = 'warm' | 'cooling' | 'cold';

export function pipelineTemperature(daysSinceLastTouch: number | null | undefined): Temperature | null {
  if (daysSinceLastTouch == null) return null; // never contacted → no marker
  if (daysSinceLastTouch <= WARM_DAYS) return 'warm';
  if (daysSinceLastTouch <= COOLING_DAYS) return 'cooling';
  return 'cold';
}

// A rank for sorting by temperature — warm first, then cooling, cold, then the
// never-contacted (null). Used by the Pipeline's "sort by temperature" option.
export function temperatureRank(t: Temperature | null): number {
  switch (t) {
    case 'warm': return 0;
    case 'cooling': return 1;
    case 'cold': return 2;
    default: return 3;
  }
}
