// Prompt 282/283 — how classifyEntityFrozenState's six values (frozen-
// classifier.ts) map onto the Pipeline header's three views. Pulled out as
// its own small pure module — not because three views is complex, but
// because this mapping got corrected TWICE in two consecutive prompts
// (282 grouped resolved_not_a_fit into Reported; 283 moved it to Frozen
// after Nuno found a real "not a fit" investor, Sofinnova MD Start,
// sitting under a 🚨 icon it never earned) while the mapping logic lived
// duplicated across the row filter, the counts, and the row pill label in
// pipeline/page.tsx. One function per concern here, reused by all three,
// is what actually prevents a future correction from landing in only one
// of those three places.
//
// Prompt 283's own principle, stated by Nuno: entering Reported requires
// EVIDENCE — the fraud-report flow with justification + proof (277 A).
// "Doesn't fit" is not an accusation and must never share the 🚨 with it.
// A real case made this concrete: Sofinnova MD Start (€4B+ AUM group,
// Capital Strategy leads biopharma/medtech deals) has a legitimate
// hard_filter "model mismatch" (it's specifically the accelerator arm,
// MD Start) — not_a_fit, same as Bynd (reaffirmed anti-medtech policy) and
// Pathena (wind-down): all three are "an impasse, won't move without a
// change in conditions" (Nuno's own Frozen definition, Prompt 282) — never
// a fraud signal.
import type { EntityFrozenState } from './frozen-classifier';

export type FrozenView = 'frozen' | 'stale' | 'reported';

export function viewForFrozenState(state: EntityFrozenState): FrozenView {
  if (state === 'blocked') return 'reported';
  if (state === 'stand_by' || state === 'no_data') return 'stale';
  return 'frozen'; // closed_for_cause, frozen_cold, not_a_fit
}

// Row-level Status pill inside a dedicated view — the sub-class
// granularity a 3-button header can't show on its own (282's own
// reasoning: collapsing 5 buttons to 3 must not lose it, just relocate it).
export function pillLabelForFrozenState(state: EntityFrozenState): string {
  switch (state) {
    case 'closed_for_cause': return 'Frozen';
    case 'frozen_cold': return 'Frozen — no reply';
    case 'not_a_fit': return 'Not a fit';
    case 'stand_by': return 'Stale';
    case 'no_data': return 'Never contacted';
    case 'blocked': return 'Fraud — pending review';
  }
}
