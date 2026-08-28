// Prompt 422 — pure cap table math. §B: a simple running total so the
// founder's own entry form can show a non-blocking "doesn't sum to 100%"
// warning. §C: proportionally diluting the founder-declared lines by an
// investor's own estimated stake, for the "Include my estimated stake"
// checkbox on the investor-side chart.
//
// Deliberately typed against a narrow {category, label, pct} shape, not
// literally CapTableEntry (which also carries id/as_of) — the investor-
// side reader (OwnershipCalculatorTool) gets rows straight off the
// dossier API response, which never sends id/as_of, and none of the math
// below needs them either.
export interface CapTableLike { category: string; label: string; pct: number }

const NEAR_100_TOLERANCE_PCT = 0.5;

export function capTableTotal(entries: CapTableLike[]): number {
  return entries.reduce((s, e) => s + e.pct, 0);
}

// §B — non-blocking: a caller renders this as a soft warning, never
// disables saving/adding a row over it.
export function isCapTableTotalOff(entries: CapTableLike[]): boolean {
  if (entries.length === 0) return false; // nothing entered yet — not "wrong", just empty
  return Math.abs(capTableTotal(entries) - 100) > NEAR_100_TOLERANCE_PCT;
}

export interface CapTableSlice { label: string; pct: number; category: string }

// §C.2 — proportionally dilutes every EXISTING line by the new investor's
// slice, so the total still sums to ~100% (a naive extra slice added on
// top would not). Uses the same multiplicative dilution principle
// computeDilution's own future-round math already applies (dilution.ts:
// `running * (1 - dilutionPct / 100)`) — adapted here to apply across every
// cap-table line at once, since computeDilution itself has no notion of a
// whole cap table, only one person's own running ownership number.
export function applyCapTableDilution(entries: CapTableLike[], investorSlicePct: number): CapTableSlice[] {
  const clampedSlice = Math.max(0, Math.min(100, investorSlicePct));
  const factor = 1 - clampedSlice / 100;
  const diluted: CapTableSlice[] = entries.map((e) => ({ label: e.label, pct: e.pct * factor, category: e.category }));
  return [...diluted, { label: 'You (estimated)', pct: clampedSlice, category: 'investor_estimate' }];
}

export function toCapTableSlices(entries: CapTableLike[]): CapTableSlice[] {
  return entries.map((e) => ({ label: e.label, pct: e.pct, category: e.category }));
}

// Prompt 432 §C — a convertible instrument's date trigger is picked as a
// quarter/year pair in the UI (no calendar precision to offer, since the
// document itself rarely states an exact day) but stored as a real date
// column; the 1st of the quarter's first month is the fixed, arbitrary-but-
// consistent day-of-month.
const QUARTER_TO_MONTH: Record<'Q1' | 'Q2' | 'Q3' | 'Q4', string> = {
  Q1: '01', Q2: '04', Q3: '07', Q4: '10',
};
export function quarterYearToIsoDate(quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4', year: string): string {
  return `${year}-${QUARTER_TO_MONTH[quarter]}-01`;
}
