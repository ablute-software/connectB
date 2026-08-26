// Prompt 388 §C.3 — Tabela 2: the read-only weighted table at the bottom of
// "Your scorecard", computed from investor_dossier_tab_scores rows across
// every dossier tab, never editable directly. Pure/tested, same discipline
// as roadmap-canvas.ts.
export interface ScorecardCriterion { id: string; label: string; weight: number }
export interface TabScoreRow { criteriaId: string; tab: string; score: number | null }
export interface WeightedCriterionValue { id: string; label: string; weight: number; value: number | null }

// A criterion's own row: the weighted average of ITS OWN entries across
// whichever tabs it was actually rated on. Its weight is constant across
// those entries (weight belongs to the criterion, not the tab), so this is
// mathematically the plain average of its scores — written as the literal
// Σ(weight×score)/Σ(weight) form the prompt specifies anyway, so a future
// per-tab weight (if that's ever added) doesn't silently break this.
// Entries with no score ("por avaliar") never enter the sum OR the count.
export function weightedCriterionValues(criteria: ScorecardCriterion[], rows: TabScoreRow[]): WeightedCriterionValue[] {
  return criteria.map((c) => {
    const own = rows.filter((r) => r.criteriaId === c.id && r.score != null);
    if (own.length === 0) return { id: c.id, label: c.label, weight: c.weight, value: null };
    const weightedSum = own.reduce((s, r) => s + c.weight * (r.score as number), 0);
    const weightSum = own.reduce((s) => s + c.weight, 0);
    return { id: c.id, label: c.label, weight: c.weight, value: weightSum > 0 ? weightedSum / weightSum : null };
  });
}

// The one big number at the top: weighted average across EVERY rated entry,
// any criterion, any tab — this is where weight actually differentiates
// criteria from one another (unlike the per-row value above).
export function overallWeightedAverage(criteria: ScorecardCriterion[], rows: TabScoreRow[]): number | null {
  const weightById = new Map(criteria.map((c) => [c.id, c.weight]));
  const rated = rows.filter((r) => r.score != null && weightById.has(r.criteriaId));
  if (rated.length === 0) return null;
  const weightedSum = rated.reduce((s, r) => s + (weightById.get(r.criteriaId) as number) * (r.score as number), 0);
  const weightSum = rated.reduce((s, r) => s + (weightById.get(r.criteriaId) as number), 0);
  return weightSum > 0 ? weightedSum / weightSum : null;
}
