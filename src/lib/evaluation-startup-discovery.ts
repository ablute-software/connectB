// Prompt 419 — pure helpers for the Evaluation Tools startup picker: name
// search (§A), which already-eligible cards this investor hasn't touched
// yet (§B.3), and which of those has the best thesis fit (§C.1). Kept
// separate from EvaluationToolsPanel.tsx (UI-only) so these are testable
// without rendering — same "logic in lib/, pure and tested" split as the
// rest of this codebase.
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

// §B.3 — "already eligible, respecting wave gating (cards is already that
// exact set — /api/portal/pipeline strips locked-wave items server-side)
// and genuinely never touched by this investor": no relationship
// (grant/decision/referral) and no interaction on any of the four
// getInteractionTimeline sources.
export function uncontactedCandidates(cards: EvaluationPipelineCard[]): EvaluationPipelineCard[] {
  return cards.filter((c) =>
    !c.viaGrant && !c.viaDecision && !c.viaReferral
    && c.status === 'open' && !c.isArchived && !c.hasConversation && !c.hasManualInteractionLog);
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
