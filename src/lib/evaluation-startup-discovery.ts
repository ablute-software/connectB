// Prompt 419 — pure helpers for the Evaluation Tools startup picker: name
// search (§A), the two states a card can be in (§B.3, rewritten by Prompt
// 562), and which untouched card has the best thesis fit (§C.1). Kept
// separate from EvaluationToolsPanel.tsx (UI-only) so these are testable
// without rendering — same "logic in lib/, pure and tested" split as the
// rest of this codebase.
//
// Prompt 562 SUPERSEDES 419 §B's "discovery mode".
//
// 419 built that mode on an assumption that was never true: that the picker
// showed the investor's ACTIVE startups and needed a way to grow the list.
// It never did — the panel flattens every unlocked wave from
// /api/portal/pipeline into one array, discovery cards and relationship
// cards alike. So `uncontactedCandidates` filtered that same array, and the
// mode presented a SUBSET of the visible list as if it were a second,
// different list. Its CTA promised "express interest or request a document
// — that's what adds them to your active list", a rule implemented nowhere:
// there is no active list, only these flags. 419's own header admitted the
// shape of it ("reusing `cards` rather than widening what's eligible"),
// which is exactly why the CTA could not deliver more startups.
//
// The data always knew both states. The UI just never showed them. So the
// mode is gone and `partitionEvaluationCards` names the two groups instead
// — one list, two sections, nothing to navigate into or back out of.
import type { ValuationBasis } from './dilution';

export interface EvaluationPipelineCard {
  orgId: string; name: string; oneLiner: string | null; sectors: string[]; stage: string | null;
  roundTargetEur: number | null; roundValuationEur: number | null;
  roundValuationBasis?: ValuationBasis | null; matchScore: number; matchReasons: string[];
  // Prompt 419 §B.3 — added so the discovery filter below can tell "already
  // has a relationship or an interaction" from "genuinely untouched",
  // without a second fetch: all already computed server-side
  // (investor-pipeline.ts's getPipelineWaves) — EvaluationToolsPanel.tsx
  // just wasn't reading them yet.
  status: 'open' | 'interested' | 'passed';
  isArchived: boolean;
  hasConversation: boolean;
  viaGrant: boolean;
  viaDecision: boolean;
  viaReferral: boolean;
  // Prompt 419 §B.3 — the one signal NOT already implied by the fields
  // above: a manual investor_interaction_log entry with no formal
  // decision/archive/match attached — one of the four sources
  // investor-interaction-log.ts's getInteractionTimeline combines.
  hasManualInteractionLog: boolean;
}

// §A — client-side only, cards are already loaded. Empty query returns
// every card unchanged (no filtering UI state to special-case at the call
// site).
export function filterCardsByName<T extends { name: string }>(cards: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return cards;
  return cards.filter((c) => c.name.toLowerCase().includes(q));
}

/** The one-line state shown under an active card's name. One label per
 *  card, never a stack of chips: the investor is choosing what to evaluate,
 *  not auditing the relationship. */
export type EvaluationCardState =
  | 'shared_documents' | 'interested' | 'passed' | 'in_conversation' | 'referred' | 'logged' | 'archived';

export const EVALUATION_STATE_LABEL: Record<EvaluationCardState, string> = {
  shared_documents: 'Shared documents with you',
  in_conversation: 'In conversation',
  interested: 'Interested',
  passed: 'Passed',
  referred: 'Referred',
  logged: 'Logged',
  archived: 'Archived',
};

/**
 * Which single state a card is in, most-committed first.
 *
 * The order is the strength of the relationship, not the order the flags
 * happen to be declared in: a startup that opened its data room to you
 * (`viaGrant`) is further along than one you merely marked interested, and
 * being in conversation is a stronger fact than the decision that started
 * it. A card carrying several flags at once is the normal case — grant AND
 * decision AND conversation — so "one label per card" needs a decided
 * precedence rather than whichever branch is tested first.
 *
 * `passed` and `archived` rank last among relationships but still count as
 * active: the tools exist to reconsider, and a passed startup you can no
 * longer select is a tool you cannot use on the case you most want to
 * re-examine.
 */
export function evaluationCardState(c: EvaluationPipelineCard): EvaluationCardState | null {
  if (c.viaGrant) return 'shared_documents';
  if (c.hasConversation) return 'in_conversation';
  if (c.status === 'interested') return 'interested';
  if (c.status === 'passed') return 'passed';
  if (c.viaDecision) return 'interested';
  if (c.viaReferral) return 'referred';
  if (c.isArchived) return 'archived';
  if (c.hasManualInteractionLog) return 'logged';
  return null;
}

export interface EvaluationCardPartition {
  active: EvaluationPipelineCard[];
  untouched: EvaluationPipelineCard[];
}

/**
 * §B.3, rewritten by Prompt 562 — the two states, as two lists.
 *
 * `active` is any relationship or interaction; `untouched` is the exact
 * predicate the deleted `uncontactedCandidates` used, so the "already
 * eligible, respecting wave gating, genuinely never touched" set is
 * unchanged — `cards` is already that exact set, because
 * /api/portal/pipeline strips locked-wave items server-side.
 *
 * Relative order is preserved inside each group (cards arrive sorted by
 * matchScore descending), so "highest fit first" needs no re-sort.
 */
export function partitionEvaluationCards(cards: EvaluationPipelineCard[]): EvaluationCardPartition {
  const active: EvaluationPipelineCard[] = [];
  const untouched: EvaluationPipelineCard[] = [];
  for (const c of cards) {
    if (evaluationCardState(c)) active.push(c);
    else untouched.push(c);
  }
  return { active, untouched };
}

// §C.1 — cards arrive already sorted descending by matchScore
// (investor-pipeline.ts sorts once, before wave-splitting, and every
// filter/slice since preserves relative order) — reduce rather than trust
// that ordering blindly, so this stays correct even if that invariant ever
// changes.
export function highestFitCandidate<T extends { matchScore: number }>(cards: T[]): T | null {
  if (cards.length === 0) return null;
  return cards.reduce((best, c) => (c.matchScore > best.matchScore ? c : best));
}
