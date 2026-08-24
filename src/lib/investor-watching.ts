// Prompt 348 — "Watching closely". Pure logic only (delta computation,
// threshold predicates, ordering) — every DB touch lives in the API
// routes, mirroring startup-snapshot.ts's own split (SnapshotData/
// captureSnapshot vs. the AI regeneration side-effect).
import type { SnapshotData } from './startup-snapshot';

export interface ChangedField { field: string; label: string; from: unknown; to: unknown }

// Same fields captureSnapshot itself persists (startup-snapshot.ts) — this
// delta is investor-private (what THIS investor already sees, compared to
// their own baseline), so raw values are safe to show as-is: no anti-
// ranking concern, unlike a founder-facing or cross-investor aggregate.
const FIELD_LABELS: Record<string, string> = {
  stage: 'Stage', sectors: 'Sectors', one_liner: 'One-liner', description: 'Description',
  round_target_eur: 'Round target', round_valuation_eur: 'Valuation', round_valuation_basis: 'Valuation basis',
  round_instruments: 'Instruments', round_target_close_date: 'Target close date', round_raising: 'Raising status',
  employee_count: 'Team size',
};

export function computeSnapshotDelta(baseline: SnapshotData, current: SnapshotData): ChangedField[] {
  const changed: ChangedField[] = [];
  for (const field of Object.keys(FIELD_LABELS) as (keyof SnapshotData)[]) {
    const from = baseline[field] ?? null;
    const to = current[field] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changed.push({ field, label: FIELD_LABELS[field], from, to });
    }
  }
  const baselineTraction = JSON.stringify(baseline.traction ?? []);
  const currentTraction = JSON.stringify(current.traction ?? []);
  if (baselineTraction !== currentTraction) {
    changed.push({ field: 'traction', label: 'Traction metrics', from: baseline.traction, to: current.traction });
  }
  return changed;
}

// Prompt 348 §C — the mechanical, verifiable threshold menu (never free
// text to interpret). match_score_above is the only kind that carries a
// numeric value; the other four are plain fact-of-existence triggers.
export type WatchThresholdKind = 'class1_evidence' | 'class2_evidence' | 'round_opened_or_changed' | 'roadmap_milestone' | 'match_score_above';

export const WATCH_THRESHOLD_KINDS: WatchThresholdKind[] = [
  'class1_evidence', 'class2_evidence', 'round_opened_or_changed', 'roadmap_milestone', 'match_score_above',
];

export const WATCH_THRESHOLD_LABELS: Record<WatchThresholdKind, string> = {
  class1_evidence: 'New class-1 evidence (paid commitment) in traction',
  class2_evidence: 'New class-2 evidence (pilot / LOI / partnership)',
  round_opened_or_changed: 'A new round opens, or the target changes',
  roadmap_milestone: 'A roadmap milestone is marked complete',
  match_score_above: 'Match score rises above a threshold',
};

// Pure crossing check — fires only the moment the score CROSSES the line,
// never on every poll while it's already above it (would spam an alert
// every time the watchlist reloads otherwise).
export function matchScoreCrossedThreshold(prevScore: number, newScore: number, thresholdValue: number): boolean {
  return prevScore <= thresholdValue && newScore > thresholdValue;
}

// Prompt 348 §E — "Most changed" ordering's own magnitude score. Claims
// weighted by evidence strength (class 1 heavier than class 2, matching the
// product's existing "class 1 is the strongest signal" hierarchy — Prompt
// 219); a plain dossier field change or a roadmap milestone both count as
// one unit of "something moved".
export function deltaMagnitude(params: { changedFieldsCount: number; newClass1Count: number; newClass2Count: number; newRoadmapCount: number }): number {
  return params.changedFieldsCount + params.newClass1Count * 3 + params.newClass2Count * 2 + params.newRoadmapCount * 2;
}

export type WatchSort = 'closest_to_criteria' | 'most_changed';

export function sortWatchItems<T extends { matchScore: number; deltaScore: number }>(items: T[], sort: WatchSort): T[] {
  const copy = [...items];
  if (sort === 'closest_to_criteria') copy.sort((a, b) => b.matchScore - a.matchScore);
  else copy.sort((a, b) => b.deltaScore - a.deltaScore);
  return copy;
}
