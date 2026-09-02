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

// Prompt 542 §1 — whether the guided-questions panel opens by itself.
//
// The panel was built (Prompt 431) as the ONLY way to fill an empty cap
// table, after the multi-document "Fill with Watson" selector was removed
// for dumping the whole Vault at the founder. It was never given a reason
// to step aside once the table had rows, so a founder with four entries
// still met a "let us help you start" panel underneath them — Nuno's words:
// "não ajuda ou acrescenta nada", which is, word for word, the same
// complaint that killed the selector in 431.
//
// The rule: the table's own state decides the DEFAULT, and an explicit
// click always wins over it. Returning `null` for "never toggled" rather
// than resolving eagerly matters — the store loads asynchronously, so a
// value computed once at mount would latch the empty-table default and
// never correct itself when the rows arrive a moment later.
//
// Same "the card goes away when it stops being needed" rule as the
// onboarding checklist (Prompt 517) and the founded-year suggestion card
// (Prompt 540); simpler than either, because it depends on nothing but
// whether the table has rows.
export function capTableGuidedPanelOpen(params: {
  hasRows: boolean;
  userToggled: boolean | null;
  // A deep link from an investor's own request (?capTableRequestItem=…)
  // opens the panel regardless of the table's state: there the founder was
  // sent here specifically to add something.
  deepLinked?: boolean;
}): boolean {
  if (params.deepLinked) return true;
  if (params.userToggled !== null) return params.userToggled;
  return !params.hasRows;
}
