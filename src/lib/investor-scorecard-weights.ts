// Prompt 388 §C.1 — originally a constant-sum weight redistribution
// system (drag one criterion, the others move to compensate). Prompt 393
// §1 removed that mechanism entirely after feedback from real testers:
// each criterion's value is now fully independent (no redistribution),
// because the final weighted score (investor-scorecard-summary.ts,
// Σ(v×score)/Σv) already normalizes by the real current sum on its own —
// adding/removing a criterion doesn't need any help staying meaningful.
export interface WeightedCriterion { id: string; weight: number }

// §C.1 — "Acrescentar um critério novo entra a 5... o total sobe
// naturalmente." No redistribution: every existing weight is untouched,
// the new one just joins at the scale's own midpoint.
export const DEFAULT_NEW_CRITERION_WEIGHT = 5;
