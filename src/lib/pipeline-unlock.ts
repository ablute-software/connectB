// Prompt 123 Block B.2 — the pipeline-unlock engine: a pure, server-side,
// testable function computing how many investors a startup's Pipeline
// currently shows. Replaces the completeness-tier cap revoked in the
// prompt's §0 (companyCompleteness.ts's former startupInvestorDeckCap,
// which governed the MatchDeal swipe deck's per-request size — a different
// surface; this governs the CRM Pipeline's total unlocked count).
import type { PlanTier } from './types';

// Prompt 123 §0.1 — the source docs disagreed: the plan card said "25
// investors available once your core profile is complete" for "It's the
// butler!", the unlock-rules section said "5, 10 ou 20" (implying a
// first-month total of 52). Default: the card wins (25) — it's the copy the
// customer actually sees, and Nuno's own note in the prompt calls it "the
// correction". Butler's first-month total becomes 57 (25+5+5+22 in the
// doc's own worked arithmetic), not the doc's stated 52. Veto = change this
// one constant.
export const PLAN_PIPELINE_BASE: Record<PlanTier, number> = {
  idea: 5, garage: 10, motherfunding: 25,
};
// "Up to 10/25/50 new Sherlock Deal investors per month" per the card copy —
// the formula's monthly_addition term.
export const PLAN_PIPELINE_MONTHLY_ADDITION: Record<PlanTier, number> = {
  idea: 10, garage: 25, motherfunding: 50,
};

const DECK_BONUS = 5;
const BUSINESS_PLAN_BONUS = 5;
const FOLDER_BONUS = 1;
const FIRST_OUTBOUND_BONUS = 1;
const FIRST_INBOUND_BONUS = 1;
const FIRST_MANUAL_ADD_BONUS = 1;

export interface PipelineUnlockInput {
  planTier: PlanTier;
  /** The B.2 entry gate — see isProfileGateComplete. false ⇒ pipeline locked (0), regardless of every other input. */
  profileGateComplete: boolean;
  investorDeckUploaded: boolean;
  businessPlanUploaded: boolean;
  /** How many of the preset Vault folders have EVER had ≥1 valid file (a one-time credit — a later delete doesn't revoke it; a second file in the same folder doesn't add another). */
  presetFoldersWithFile: number;
  /** Parametrized, never hard-coded — pass PRESET_FOLDER_COUNT (vault-preset-folders.ts) in production. */
  presetFolderCount: number;
  firstOutboundLogged: boolean;
  firstInboundLogged: boolean;
  firstManualAddLogged: boolean;
  /** floor(months elapsed since profile_completed_at) — see completeMonthsSince. */
  completeMonthsSinceUnlock: number;
  /** The real, currently-eligible investor pool for this org — the formula never promises more than actually exists. */
  eligiblePoolSize: number;
}

export function visiblePipelineSize(input: PipelineUnlockInput): number {
  if (!input.profileGateComplete) return 0;
  const folders = Math.max(0, Math.min(input.presetFoldersWithFile, input.presetFolderCount));
  const months = Math.max(0, Math.floor(input.completeMonthsSinceUnlock));
  const raw = PLAN_PIPELINE_BASE[input.planTier]
    + (input.investorDeckUploaded ? DECK_BONUS : 0)
    + (input.businessPlanUploaded ? BUSINESS_PLAN_BONUS : 0)
    + folders * FOLDER_BONUS
    + (input.firstOutboundLogged ? FIRST_OUTBOUND_BONUS : 0)
    + (input.firstInboundLogged ? FIRST_INBOUND_BONUS : 0)
    + (input.firstManualAddLogged ? FIRST_MANUAL_ADD_BONUS : 0)
    + PLAN_PIPELINE_MONTHLY_ADDITION[input.planTier] * months;
  return Math.min(raw, Math.max(0, input.eligiblePoolSize));
}

// Pure/deterministic on purpose — no Date.now() inside, the caller passes
// "now" explicitly so this stays unit-testable and consistent with the
// workflow-script restriction elsewhere in this codebase (no wall-clock
// reads inside pure library functions).
export function completeMonthsSince(fromIso: string, nowIso: string): number {
  const from = new Date(fromIso);
  const now = new Date(nowIso);
  let months = (now.getFullYear() - from.getFullYear()) * 12 + (now.getMonth() - from.getMonth());
  if (now.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

// B.2's "gate de entrada" — the minimum profile required before the
// pipeline unlocks at all. Field-by-field against the real schema
// (types.ts's Org), per the prompt's own instruction that any field
// without a home gets flagged, not invented:
//   website                  -> org.website
//   sector                   -> org.sectors (fixed taxonomy) / sectors_other
//   estágio de investimento  -> org.stage (pre_seed/seed/series_a/later/other)
//   país                     -> org.country
//   valor da ronda           -> org.round_target_eur
//   fase actual              -> org.current_phase (5-value enum, matches the prompt's own list verbatim)
//   ano de fundação          -> org.founded_year
//   revenue                  -> org.revenue_eur
//   contacto                 -> org.primary_contact_person_id — FLAGGED: Org
//     has no dedicated "contact" column; this is the closest existing
//     concept (a named primary contact among company_people, the same field
//     companyCompleteness.ts's 'team.primary_contact' already uses). If a
//     different field is meant, that's a decision for Nuno, not a guess.
export interface ProfileGateOrg {
  website?: string | null;
  sectors?: string[] | null;
  sectors_other?: string | null;
  stage?: string | null;
  country?: string | null;
  round_target_eur?: number | null;
  current_phase?: string | null;
  founded_year?: number | null;
  revenue_eur?: number | null;
  primary_contact_person_id?: string | null;
}
// Same document-name keyword-matching convention as action-plan.ts's
// dataroomChecklist/hasDoc — "investor deck" and "business plan" have no
// dedicated schema field (no folder named "Business plan" exists in the
// real Vault preset, vault-preset-folders.ts), so presence is read from
// whatever the founder actually named the file, in whichever folder they
// put it.
export function hasAnyDocumentNamed(documentNames: string[], keywords: string[]): boolean {
  const lower = documentNames.map((n) => n.toLowerCase());
  return keywords.some((kw) => lower.some((n) => n.includes(kw)));
}

export function isProfileGateComplete(org: ProfileGateOrg): boolean {
  return !!(
    org.website?.trim() &&
    ((org.sectors?.length ?? 0) > 0 || org.sectors_other?.trim()) &&
    org.stage &&
    org.country?.trim() &&
    org.round_target_eur != null &&
    org.current_phase &&
    org.founded_year != null &&
    org.revenue_eur != null &&
    org.primary_contact_person_id
  );
}
