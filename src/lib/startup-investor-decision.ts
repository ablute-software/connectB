// Prompt 852 §A/§B/§C — the startup's own "no", and the rules that keep it
// separate from the investor's.
//
// THE DISTINCTION THIS FILE EXISTS TO HOLD. Two different acts, by two
// different parties, with different consequences:
//
//   THEY passed   — an `interactions` row with classification 'pass',
//                   entity status 'passed', a pass reason, optionally a
//                   rejection_code. Feeds passReasonAlert ("3+ passes for
//                   the same reason — the pitch may be the problem"), the
//                   reawakening prefilter and the Dashboard.
//   WE said no    — a `startup_investor_decisions` row (migration 0339).
//                   "We met them before and they were not aligned"; "the
//                   treatment was poor". Writes NO interaction, touches NO
//                   entity status, creates NO rejection code.
//
// A founder's own decision must never inflate the pass-pattern alert, which
// exists to tell the founder their PITCH is the problem. It must never read
// as an investor rejection anywhere. And it must never appear as a prior
// "no" the reawakening engine argues against. Those three properties are
// structural here — this record simply is not an interaction — rather than
// something each consumer has to remember to filter out.
//
// Naming, because the collision is real: the existing EntityFrozenState
// value 'not_a_fit' (hard_filter_status='resolved_not_a_fit', migration
// 0195) is the PLATFORM's hard filter resolving a thesis mismatch, and its
// row pill already reads "Not a fit". This is a different thing and is
// always labelled "Not a fit for us" — the founder's own words, the
// founder's own act.
import type { PassReasonCategory } from './types';

/** Same cap on all three founder notes (§A's note, §D's pass reason and
 *  "what's needed to restart"), enforced in the Postgres CHECK too. */
export const DECISION_NOTE_MAX = 220;

/** Prompt 852 §D.1 — the existing floor on the reopen note, moved here from
 *  SherlockInsightBanner's own local const so the pass form and the banner's
 *  editor enforce the SAME number. Two copies of "long enough to be a real
 *  note" is how one of them ends up letting a stub through to the
 *  reawakening engine. */
export const REOPEN_TRIGGER_MIN_LENGTH = 15;

export type StartupInvestorDecisionKind = 'not_a_fit';

export const NOT_A_FIT_LABEL = 'Not a fit for us';
export const THEY_PASSED_LABEL = 'They passed';

export interface StartupInvestorDecision {
  id: string;
  org_id: string;
  entity_id: string;
  catalog_entity_id?: string;
  decision: StartupInvestorDecisionKind;
  reason_category?: PassReasonCategory;
  note: string;
  decided_by: string;
  decided_at: string;
  reverted_at?: string;
  reverted_by?: string;
  updated_at: string;
  updated_by?: string;
}

/** A decision is LIVE until it is reverted. Reverting never deletes: the row
 *  stays so the history is honest, and the unique index frees the slot. */
export function isLiveDecision(d: Pick<StartupInvestorDecision, 'reverted_at'>): boolean {
  return !d.reverted_at;
}

export function liveDecisionByEntity(
  decisions: StartupInvestorDecision[],
): Map<string, StartupInvestorDecision> {
  const out = new Map<string, StartupInvestorDecision>();
  for (const d of decisions) if (isLiveDecision(d)) out.set(d.entity_id, d);
  return out;
}

export type NoteProblem = 'empty' | 'too_long' | null;

/** The one validator both the form and the route use, so a note that the
 *  browser accepted can never be the one Postgres rejects. */
export function noteProblem(note: string | null | undefined): NoteProblem {
  const trimmed = (note ?? '').trim();
  if (trimmed.length === 0) return 'empty';
  if (trimmed.length > DECISION_NOTE_MAX) return 'too_long';
  return null;
}

export function noteProblemMessage(problem: NoteProblem): string | null {
  if (problem === 'empty') return 'Write a note — a decision with no reason is not a record.';
  if (problem === 'too_long') return `Keep it to ${DECISION_NOTE_MAX} characters.`;
  return null;
}

// §C — the Passed view lists BOTH directions, and each row says which way
// the "no" went. One number that hid that would be worse than no number.
export type PassedDirection = 'they_passed' | 'not_a_fit_for_us';

export function passedDirectionLabel(direction: PassedDirection): string {
  return direction === 'they_passed' ? THEY_PASSED_LABEL : NOT_A_FIT_LABEL;
}

/**
 * §C — which entities belong in the Passed view, and under which label.
 * "They passed" is today's `status === 'passed'` (written by the pass flow
 * alongside its classification='pass' interaction); "Not a fit for us" is a
 * live §A decision. An entity can in principle be both — they passed, and
 * later the founder recorded that they would not go back — in which case the
 * founder's own decision is the one shown: it is the more recent statement of
 * where the relationship actually stands, and it is the one the founder can
 * revert.
 */
export function passedDirections(
  entities: { id: string; status?: string | null }[],
  decisions: StartupInvestorDecision[],
): Map<string, PassedDirection> {
  const live = liveDecisionByEntity(decisions);
  const out = new Map<string, PassedDirection>();
  for (const e of entities) {
    if (live.has(e.id)) out.set(e.id, 'not_a_fit_for_us');
    else if (e.status === 'passed') out.set(e.id, 'they_passed');
  }
  return out;
}
