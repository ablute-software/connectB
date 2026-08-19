// Prompt 271 — deterministic split of the frozen (status='dormant') list
// into two structurally different situations. Pure, no I/O; the whole
// point (per the prompt's own "distinção deterministica primeiro, como
// sempre") is that classification never needs AI — only the evaluation of
// class B candidates does (a separate, on-demand step).
//
// Real counts that motivated this (SQL against production, ablute_ org,
// confirmed by Nuno before this prompt): 20/34 frozen entities have an
// INBOUND last interaction with zero follow-up from us — frozen by
// inactivity, not decision. 3/34 have a real pass (classification='pass').
// 2/34 have a reopen_trigger. 1/34 has no interactions at all.
//
// Signal set deliberately narrow: a rejection_codes row can only ever
// exist alongside a real pass interaction (Prompt 251 Bloc A captures it
// AT pass time, source_interaction_id), so checking for a pass interaction
// already transitively covers "coded pass" — no separate rejection_codes
// check needed. relationship_state.stage==='decision' is deliberately
// NOT a signal here: reaching decision stage isn't the same as a resolved
// decision — using it would risk misclassifying a stalled-but-never-
// decided entity as closed_for_cause. Last-interaction DIRECTION is not
// part of the 3-way split either (an all-outbound thread that fizzled is
// still dropped_by_us) — it only feeds presentation (the Fase 0 Tip text,
// lastInteractionSummary below), kept separate from classification.
import type { Entity, Interaction } from './types';

export type FrozenClass = 'closed_for_cause' | 'dropped_by_us' | 'no_data';

export function classifyFrozen(
  entity: Pick<Entity, 'reopen_trigger' | 'reopen_eligible_after'>,
  interactions: Pick<Interaction, 'classification'>[],
): FrozenClass {
  if (interactions.length === 0) return 'no_data';
  const hasCause = !!entity.reopen_trigger || !!entity.reopen_eligible_after
    || interactions.some((i) => i.classification === 'pass');
  return hasCause ? 'closed_for_cause' : 'dropped_by_us';
}

export interface LastInteractionSummary {
  occurredAt: string;
  direction: 'in' | 'out';
}

// The founder's own last touch on this entity (either direction) — used by
// both the Fase 0 Tip (§4) and the neglect-evaluation AI prompt (§3), so
// both describe the same fact the same way.
export function lastInteractionSummary(interactions: Pick<Interaction, 'occurred_at' | 'direction'>[]): LastInteractionSummary | undefined {
  const last = [...interactions].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1);
  return last ? { occurredAt: last.occurred_at, direction: last.direction } : undefined;
}
