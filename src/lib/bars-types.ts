// Prompt 411 §A.2 — types for the BARS (Behaviorally Anchored Rating
// Scale) question banks and the investor's own answers/state. Same
// versioned-content discipline as src/content/terms/ (terms.ts) — a bank
// is immutable once published; a material change is a new bank version,
// never a silent edit of the old one's text.
import type { CompanyPhase } from './types';

export type BarsAxis = 'team' | 'market' | 'product' | 'technology';

// The source-strength tiers an investor can attach as evidence for an
// answer — the same 6 kinds bars_answers.evidence_refs stores server-side.
// investor_note is the "references, meeting notes" tier (investor-
// observed/assumption) — bars-scoring.ts's confidenceBand is what actually
// maps each kind to a strength tier for the Confidence band.
export type EvidenceKind = 'claim' | 'document' | 'traction_metric' | 'roadmap_event' | 'interaction' | 'investor_note';

export interface BarsAnchor {
  l1: string;
  l3: string;
  l5: string;
  // The "two equivalent paths to 5" pattern (team.founder_opportunity_fit,
  // market.differentiation_space) — when set, the UI offers BOTH l5 and
  // l5b as distinct clickable options carrying the same value (5). Each
  // string carries its own "path A/path B — ..." label prefix, same as
  // the source content does.
  l5b?: string;
}

export interface BarsQuestion {
  id: string; // e.g. 'team.founder_opportunity_fit' — stable, versioned with the bank
  axis: BarsAxis;
  subdimension: string; // e.g. Team's Capability/Configuration/Behaviour; axis-specific label for the other three
  stages: CompanyPhase[]; // which phases this question applies to — see phaseRange() below for the "all/prototype+/pilot+/launch+" shorthands the source docs use
  question: string;
  anchors: BarsAnchor;
  stageNotes?: string; // adjusts how the anchors read at certain stages, never a second copy of the question
  evidenceHints: EvidenceKind[];
  why: string; // internal only ("why it discriminates") — never shown to the investor
}

export interface BarsRedFlag {
  id: string; // e.g. 'team.rf_no_fulltime'
  axis: BarsAxis;
  check: string; // the CONFIRMED-state description (Confirmed vs. Critical Unverified — the confirmed check is what this string names)
  capLevel: 1 | 2 | 3 | 4 | 5;
}

export interface BarsBank {
  axis: BarsAxis;
  version: string; // e.g. 'team_v1' — §A.1's own note: the markdown v1/v2 cycle was the REVIEW cycle, not the product's; every bank's content-version label starts at _v1
  questions: BarsQuestion[];
  redFlags: BarsRedFlag[];
}

// Shorthand used throughout the source content ("all", "prototype+",
// "pilot+", "launch+") expanded against the real CompanyPhase enum —
// note its actual values (concept_idea, launch_early_adopters) differ
// from the docs' casual "concept"/"launch" shorthand.
const PHASE_ORDER: CompanyPhase[] = ['concept_idea', 'prototype', 'pilot', 'launch_early_adopters', 'growth'];
export function phaseRange(from: CompanyPhase): CompanyPhase[] {
  return PHASE_ORDER.slice(PHASE_ORDER.indexOf(from));
}
export const ALL_PHASES: CompanyPhase[] = PHASE_ORDER;

// Prompt 411 §B.4 / 412 §C — the Risk Register's own fixed 14-category
// taxonomy (investor_case_risks.category) and probability/impact/residual
// scale. A separate vocabulary from BarsAxis, not a duplicate of it — 4 of
// the 14 categories happen to share a name with a BARS axis (used by 412
// §C.3's "suggested evidence from your {axis} assessment" mapping), the
// other 10 (adoption, commercial, financial, financing, governance,
// legal_ip, regulatory, competitive, execution, exit_liquidity) have no
// BARS-axis counterpart at all.
export const RISK_CATEGORIES = [
  'technology', 'product', 'market', 'adoption', 'commercial', 'financial',
  'financing', 'team', 'governance', 'legal_ip', 'regulatory', 'competitive',
  'execution', 'exit_liquidity',
] as const;
export type RiskCategory = typeof RISK_CATEGORIES[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;
export type RiskLevel = typeof RISK_LEVELS[number];
