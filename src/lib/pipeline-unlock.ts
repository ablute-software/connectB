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

// Prompt 181 — month 1's (base + bonuses) is now CAPPED at
// PLAN_PIPELINE_MONTHLY_ADDITION[tier] (10/25/50), not summed without
// limit: filling in EVERY bonus (deck+business plan+13 Vault folders+first
// out/in/manual = 5+5+13+1+1+1 = 26) used to land idea-tier at 31
// (base 5 + bonus 26) — the prompt's own example of the bug it closes.
// From month 2 on, the existing monthly term (PLAN_PIPELINE_MONTHLY_ADDITION
// * months, unchanged) keeps adding on top of that capped month-1 value,
// uncapped.
//
// DEVIATION from the prompt's own literal sub-formula, flagged: it describes
// "PLAN_PIPELINE_BASE[tier] + min(bónus, PLAN_PIPELINE_MONTHLY_ADDITION[tier])",
// i.e. capping the BONUS alone. That does not reconcile with the prompt's own
// stated ceiling (10/25/50) or its own "Disciplina de sempre" test/worked
// table (month1=10/25/50, month2=20/50/100, month3=30/75/150): base(5)+
// min(bonus,10)=5+10=15 for idea, not 10. The numbers only reconcile when
// base+bonus TOGETHER are capped at PLAN_PIPELINE_MONTHLY_ADDITION[tier]:
// min(5+26,10)=10 (idea), min(10+26,25)=25 (garage), min(25+26,50)=50
// (motherfunding) — exactly the prompt's own stated 10/25/50, and month2/3
// (+10 or +25 or +50 per month on top) reproduce its worked table exactly.
// Implemented against the numbers the prompt actually commits to (the
// ceiling + the test), not its own inconsistent prose formula.
export function visiblePipelineSize(input: PipelineUnlockInput): number {
  if (!input.profileGateComplete) return 0;
  const folders = Math.max(0, Math.min(input.presetFoldersWithFile, input.presetFolderCount));
  const months = Math.max(0, Math.floor(input.completeMonthsSinceUnlock));
  const baseAndBonuses = PLAN_PIPELINE_BASE[input.planTier]
    + (input.investorDeckUploaded ? DECK_BONUS : 0)
    + (input.businessPlanUploaded ? BUSINESS_PLAN_BONUS : 0)
    + folders * FOLDER_BONUS
    + (input.firstOutboundLogged ? FIRST_OUTBOUND_BONUS : 0)
    + (input.firstInboundLogged ? FIRST_INBOUND_BONUS : 0)
    + (input.firstManualAddLogged ? FIRST_MANUAL_ADD_BONUS : 0);
  const raw = Math.min(baseAndBonuses, PLAN_PIPELINE_MONTHLY_ADDITION[input.planTier])
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

// Prompt 536 §4 — filename matching alone silently lost a bonus the founder
// had genuinely earned. Krohnsty uploaded `03_Krohnsty_Investment_Deck.pdf`
// INTO the preset Vault folder literally named "Investor deck", and
// hasAnyDocumentNamed(['investor deck','pitch deck']) returned false: the
// filename says "Investment_Deck", not "investor deck". The founder did
// exactly the right thing — put the deck in the deck folder — and the
// formula scored it as if no deck existed (measured: quota 8 instead of 10).
//
// The folder IS the category. vault-preset-folders.ts ships "Pitch deck" and
// "Investor deck" as preset folders, so for a deck the category is already
// recorded structurally and doesn't need to be guessed from a filename the
// founder chose freely. Filename matching stays as a FALLBACK, never
// removed: a founder who keeps a deck in some folder of their own (or in a
// data-room section) still gets the credit they used to get. This can only
// ever turn a false negative into a true positive.
//
// "Business plan" has no preset folder of its own (confirmed against
// PRESET_FOLDER_NAMES), so it keeps the filename path as its only route
// today — the folder list below is the hook for the day one exists, not a
// promise that it does.
export interface DocumentForBonus {
  name: string;
  /** The name of the folder the document sits in, or null/undefined at the Vault root. */
  folderName?: string | null;
}

export const DECK_BONUS_FOLDERS = ['investor deck', 'pitch deck'];
export const DECK_BONUS_KEYWORDS = ['investor deck', 'pitch deck'];
export const BUSINESS_PLAN_BONUS_FOLDERS = ['business plan'];
export const BUSINESS_PLAN_BONUS_KEYWORDS = ['business plan'];

// Folder match is on the WHOLE name, not a substring: "Investor deck" is a
// category, whereas a folder called "Old investor deck drafts" is a
// judgement call the founder hasn't made. Filename match stays a substring,
// which is what the existing behaviour was and what the fallback needs.
export function hasDocumentForBonus(
  documents: DocumentForBonus[], folderNames: string[], nameKeywords: string[],
): boolean {
  const folders = folderNames.map((f) => f.toLowerCase());
  return documents.some((d) => {
    const folder = d.folderName?.trim().toLowerCase();
    if (folder && folders.includes(folder)) return true;
    const name = d.name.toLowerCase();
    return nameKeywords.some((kw) => name.includes(kw));
  });
}

// Prompt 536 §1 — the nine gate fields, each with the label the founder
// sees, so the Pipeline can say WHICH one is missing instead of quoting a
// percentage from a different calculation. isProfileGateComplete is derived
// from this list rather than repeating the conditions: two copies of "what
// complete means" is exactly the bug this prompt exists to close, and a
// second copy inside this very file would be the shortest possible route
// back to it.
const PROFILE_GATE_FIELDS: { label: string; present: (org: ProfileGateOrg) => boolean }[] = [
  { label: 'website', present: (o) => !!o.website?.trim() },
  { label: 'sector', present: (o) => (o.sectors?.length ?? 0) > 0 || !!o.sectors_other?.trim() },
  { label: 'investment stage', present: (o) => !!o.stage },
  { label: 'country', present: (o) => !!o.country?.trim() },
  { label: 'round target', present: (o) => o.round_target_eur != null },
  { label: 'current phase', present: (o) => !!o.current_phase },
  { label: 'founding year', present: (o) => o.founded_year != null },
  { label: 'revenue', present: (o) => o.revenue_eur != null },
  { label: 'primary contact', present: (o) => !!o.primary_contact_person_id },
];

export function missingProfileGateFields(org: ProfileGateOrg): string[] {
  return PROFILE_GATE_FIELDS.filter((f) => !f.present(org)).map((f) => f.label);
}

export function isProfileGateComplete(org: ProfileGateOrg): boolean {
  return missingProfileGateFields(org).length === 0;
}
