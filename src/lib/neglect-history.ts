// Prompt 513 §2 — the memory that "Ask Sherlock" never had.
//
// The bug this closes, confirmed in production: a `not_worth_it` /
// `hold_for_hook` verdict was only ever shown through a React state map
// (`neglectResults` in the Pipeline page) that nothing persisted. A reload,
// a route change, or just a remount erased it — so the founder saw a flash
// of text and then nothing, AND the entity became eligible for "evaluate
// all" again on the very next visit. The route's own dedup only looked at
// `status='pending'`, and a non-reactivate verdict is written straight to
// `status='dismissed'`, so it never counted as "already asked". Result: the
// same ~13 entities were evaluated three times in three minutes, at real
// API cost each time, with nothing durable to show for it.
//
// The fix is not a new table: `reawakening_proposals` already stores every
// verdict (rationale, advice, created_at) for all three outcomes. This
// module is the pure reading of that history — same function on the client
// (what the row renders) and on the server (which entities an "evaluate
// all" is allowed to spend a call on), so the two can never drift.
import type { NeglectAdvice, ReawakeningStatus } from './types';
import type { NeglectOutcome } from './neglect-evaluation';

// Re-ask criterion (§2 asked for one, and for the reason to be recorded).
// The old behaviour was "always re-askable"; the new one is "re-askable
// once something could plausibly have changed the answer":
//
//  * a new interaction with this entity — the thread itself moved, which is
//    the single biggest input to the verdict (it reasons from the last
//    message);
//  * a new CONFIRMED company fact — this is precisely what a
//    `hold_for_hook` is waiting for. The verdict literally means "worth
//    answering, but there is no genuine new reason to reopen yet"; a
//    confirmed fact is that reason, and `neglect-evaluate`'s own prompt
//    can only cite confirmed facts as a hook. Not entity-scoped on purpose:
//    the hook is about the startup, not about them;
//  * otherwise, a plain age floor — 30 days. Nothing has provably changed,
//    but the world moves; this stops a verdict being frozen forever without
//    turning the page into a re-billing loop on every visit.
//
// A verdict still sitting in the queue (`pending`, i.e. a reactivate the
// founder hasn't approved or rejected) is never re-askable at all — not
// even by the explicit "Ask again" control. There is already an unresolved
// answer on screen; asking again would just duplicate it. That mirrors the
// route's original `alreadyPending` rule, which stays exactly as it was.
export const NEGLECT_REASK_AFTER_DAYS = 30;

export type NeglectReaskReason = 'new_interaction' | 'new_fact' | 'aged_out';

// Structural, not `Interaction`/`CompanyFact` from types.ts: the API route
// selects its own narrow column sets server-side, and the client passes the
// full store rows. Both satisfy these, so neither needs a cast — and the
// two callers stay provably on the same rule.
export interface NeglectAskInteraction { occurred_at: string; created_at?: string }
export interface NeglectAskFact { created_at: string; confirmed_at?: string }

// The subset of a ReawakeningProposal row this module needs. Structural so
// both the client's `ReawakeningProposal` and the route's own service-role
// select satisfy it without either importing the other's shape.
export interface NeglectProposalRecord {
  entity_id: string;
  trigger_kind?: string;
  reopens: boolean;
  rationale?: string;
  advice?: NeglectAdvice;
  status: ReawakeningStatus;
  created_at: string;
}

// The stored row carries no `outcome` column — the three outcomes are
// encoded by (reopens, advice), exactly as neglectProposalPayload writes
// them. `hold_for_hook` and `not_worth_it` share (reopens:false,
// status:'dismissed') and are told apart only by `advice` being present.
// If migration 0193 (the advice column) isn't applied on a given instance,
// a hold_for_hook reads back as not_worth_it and shows its rationale —
// degraded, never wrong: the rationale is written for every outcome.
export function neglectOutcomeOf(p: Pick<NeglectProposalRecord, 'reopens' | 'advice'>): NeglectOutcome {
  if (p.reopens) return 'reactivate';
  return p.advice ? 'hold_for_hook' : 'not_worth_it';
}

// Most recent neglect verdict for one entity, whatever its status —
// dismissed counts, which is the whole point (see the header).
export function latestNeglectProposal<T extends NeglectProposalRecord>(
  proposals: T[], entityId: string,
): T | undefined {
  let best: T | undefined;
  for (const p of proposals) {
    if (p.entity_id !== entityId) continue;
    if (p.trigger_kind !== 'neglect') continue;
    if (!best || p.created_at > best.created_at) best = p;
  }
  return best;
}

// When an interaction "counts" as having happened since the last ask:
// created_at when the DB has it (a 2018 conversation typed in today is new
// information for the founder even though occurred_at is ancient), falling
// back to occurred_at for rows that predate that column being surfaced.
function interactionLoggedAt(i: NeglectAskInteraction): string {
  return i.created_at ?? i.occurred_at;
}

function factConfirmedAt(f: NeglectAskFact): string {
  return f.confirmed_at ?? f.created_at;
}

// null = nothing has changed since the last verdict, so an automatic
// ("evaluate all") re-ask must skip this entity. The founder's own
// explicit "Ask again" can still override this — but never a `pending` one.
export function neglectReaskReason(
  last: Pick<NeglectProposalRecord, 'status' | 'created_at'>,
  ctx: { interactions: NeglectAskInteraction[]; confirmedFacts: NeglectAskFact[]; now: Date },
): NeglectReaskReason | null {
  if (last.status === 'pending') return null;
  if (ctx.interactions.some((i) => interactionLoggedAt(i) > last.created_at)) return 'new_interaction';
  if (ctx.confirmedFacts.some((f) => factConfirmedAt(f) > last.created_at)) return 'new_fact';
  const ageMs = ctx.now.getTime() - new Date(last.created_at).getTime();
  if (ageMs >= NEGLECT_REASK_AFTER_DAYS * 24 * 60 * 60 * 1000) return 'aged_out';
  return null;
}

export interface NeglectAskState {
  // What the row shows, and what "evaluate all" is allowed to spend on.
  last?: NeglectProposalRecord;
  outcome?: NeglectOutcome;
  // true = a bulk "evaluate all" may include this entity.
  autoAskable: boolean;
  // true = the founder's explicit "Ask again" is offered. False only while
  // a reactivate sits unresolved in the queue.
  manualAskable: boolean;
  reaskReason: NeglectReaskReason | null;
}

export function neglectAskState(
  proposals: NeglectProposalRecord[], entityId: string,
  ctx: { interactions: NeglectAskInteraction[]; confirmedFacts: NeglectAskFact[]; now: Date },
): NeglectAskState {
  const last = latestNeglectProposal(proposals, entityId);
  if (!last) return { autoAskable: true, manualAskable: true, reaskReason: null };
  const reaskReason = neglectReaskReason(last, ctx);
  return {
    last, outcome: neglectOutcomeOf(last),
    autoAskable: reaskReason !== null,
    manualAskable: last.status !== 'pending',
    reaskReason,
  };
}
