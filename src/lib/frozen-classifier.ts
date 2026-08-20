// Prompt 271 — deterministic split of the frozen (status='dormant') list
// into structurally different situations. Pure, no I/O; the whole point
// (per the prompt's own "distinção deterministica primeiro, como
// sempre") is that classification never needs AI — only the evaluation of
// stand_by candidates does (a separate, on-demand step).
//
// Real counts that motivated Prompt 271 (SQL against production, ablute_
// org, confirmed by Nuno before that prompt): 20/34 frozen entities have
// an INBOUND last interaction with zero follow-up from us. 3/34 have a
// real pass (classification='pass'). 2/34 have a reopen_trigger. 1/34 has
// no interactions at all.
//
// Prompt 273 CORRECTION — a real bug in the original design, caught by
// Nuno with a second real case: Alter VP (2 outbound from us, zero
// replies) was classified 'dropped_by_us' — wrong. Nobody dropped a
// thread there; THEY never responded. The original comment here even
// argued this deliberately ("direction never decides the class") — that
// was the mistake. Direction now DOES decide the split within "no pass,
// no reopen_trigger": last inbound (they spoke, we owe a reply, WE can
// fix this unilaterally) is stand_by; last outbound or no reply at all
// (we already reached out, the ball is in THEIR court, and the app's own
// discipline — rules.ts's own follow-up-limit — already says don't send
// a 3rd unanswered message) is frozen_cold, grouped with closed_for_cause
// under the same "needs a real new hook, matrix/reopen doctrine governs
// it" umbrella (Prompt 273's own framing).
//
// Signal set otherwise unchanged: a rejection_codes row can only ever
// exist alongside a real pass interaction (Prompt 251 Bloc A captures it
// AT pass time, source_interaction_id), so checking for a pass interaction
// already transitively covers "coded pass" — no separate rejection_codes
// check needed. relationship_state.stage==='decision' is deliberately
// NOT a signal here: reaching decision stage isn't the same as a resolved
// decision — using it would risk misclassifying a stalled-but-never-
// decided entity as closed_for_cause.
import type { Entity, Interaction } from './types';

export type FrozenClass = 'stand_by' | 'closed_for_cause' | 'frozen_cold' | 'no_data';

// Deliberately checks ANY interaction ever classified 'pass' for the
// closed_for_cause branch, not just the most recent inbound one (contrast
// with effectiveMode's stricter "last inbound only" reading,
// relationship.ts) — matches Nuno's own SQL count this prompt is built on
// ("3/34 tem um pass real registado"). The two can diverge on a narrow
// edge case (an old pass followed by a later non-pass inbound, still
// status='dormant') — effectiveMode would keep routing that entity
// through 'parked', while this still reads it as closed_for_cause.
// Harmless either way: nextBestAction's Fase 0 branch (relationship.ts)
// only ever reaches this function once effectiveMode already said
// 'parked', and closed_for_cause there just means the dropped-thread text
// doesn't fire — never a wrong/contradictory one.
export function classifyFrozen(
  entity: Pick<Entity, 'reopen_trigger' | 'reopen_eligible_after'>,
  interactions: Pick<Interaction, 'classification' | 'direction' | 'occurred_at'>[],
): FrozenClass {
  if (interactions.length === 0) return 'no_data';
  const hasCause = !!entity.reopen_trigger || !!entity.reopen_eligible_after
    || interactions.some((i) => i.classification === 'pass');
  if (hasCause) return 'closed_for_cause';
  const last = lastInteractionSummary(interactions);
  return last?.direction === 'in' ? 'stand_by' : 'frozen_cold';
}

// Prompt 273 §3 / Prompt 277 A — hard_filter_status='resolved_not_a_fit' or
// 'resolved_blocked' both take precedence over EVERYTHING else, including
// status itself: either is a stronger, orthogonal signal than being frozen
// — an entity can reach either before ever going dormant. Named as a
// distinct wrapper (not folded into classifyFrozen's own enum) because
// it's checked first and short-circuits the frozen classification
// entirely; call sites that only ever deal with already-dormant entities
// (nextBestAction's Fase 0 branch) can keep calling classifyFrozen
// directly without this extra field.
//
// Prompt 277 A — the literal stays 'blocked' here on purpose (existing
// tests/call sites keep working unchanged, per the prompt's own "sem
// tocar no existente"), even though Prompt 277 retired "Blocked" from the
// founder-facing UI COPY for this state (it now reads "Reported — pending
// review", never a verdict — see HardFilterBanner). The underlying DB
// value is still hard_filter_status='resolved_blocked' (a founder-
// submitted fraud/scam report, evidence + justification in
// entity_fraud_flags, migration 0196); only the label changed, not this
// function's return value. 'not_a_fit' is the new, separate, no-drama
// state ("not even the right kind of investor" — an accelerator, a
// service provider) — resolved_not_a_fit, checked first since the two are
// mutually exclusive (a single hard_filter_status column) but distinct
// concerns worth keeping in a stable check order.
export type EntityFrozenState = FrozenClass | 'not_a_fit' | 'blocked';

export function classifyEntityFrozenState(
  entity: Pick<Entity, 'reopen_trigger' | 'reopen_eligible_after' | 'hard_filter_status'>,
  interactions: Pick<Interaction, 'classification' | 'direction' | 'occurred_at'>[],
): EntityFrozenState {
  if (entity.hard_filter_status === 'resolved_not_a_fit') return 'not_a_fit';
  if (entity.hard_filter_status === 'resolved_blocked') return 'blocked';
  return classifyFrozen(entity, interactions);
}

export interface LastInteractionSummary {
  occurredAt: string;
  direction: 'in' | 'out';
}

// The founder's own last touch on this entity (either direction) — used by
// both the Fase 0 Tip and the neglect-evaluation AI prompt, so both
// describe the same fact the same way.
export function lastInteractionSummary(interactions: Pick<Interaction, 'occurred_at' | 'direction'>[]): LastInteractionSummary | undefined {
  const last = [...interactions].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)).at(-1);
  return last ? { occurredAt: last.occurred_at, direction: last.direction } : undefined;
}
