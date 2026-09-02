// Company tab redesign — "Profile Strength" completeness engine. ONE
// constant, ONE calculation function — nothing about the % lives anywhere
// else.
//
// Prompt 542 §2 — REBALANCED, and given three dimensions it never had.
//
// The bug, measured rather than guessed: a brand-new org, straight out of
// signup with nothing uploaded, scored 34%. That is not a rounding
// artefact — it is exactly 40 of the old 119 weight, from the six fields
// /api/provision-org writes at registration (commercial name 8, website 5,
// country 5, one-liner 8, round stage 6, round target 8). Prompt 539 adds
// four more to that set (sectors, and the founder's own company_people row
// giving team.people + team.founder + team.primary_contact), which under
// the old weights would have taken a fresh signup to 66/119 = 55%.
//
// Two things were wrong, and they compound:
//
//  1. The fields registration fills carried the same weight as fields a
//     founder has to sit down and think about. Having an account is not
//     progress, and the bar was mostly measuring that.
//  2. The bar had NO field for a document, a cap table row, or a traction
//     metric — the three things an investor actually opens. So "I have
//     uploaded nothing" was structurally invisible to it, which is why the
//     number could be high and empty at the same time.
//
// The rebalance: every field registration fills is worth 1, and the three
// evidence dimensions carry the weight. The tooltip ("investors use it
// to…") is unchanged because it finally becomes true.
//
// Calibration, stated so it can be re-checked rather than trusted:
//   - the 10 signup-filled fields total 10 of 150 = 7% (target was ≤8%);
//   - 70% is unreachable without a deck (46 > 30% of 150), and unreachable
//     without a cap table or traction (46 > 30% of 150). Without either,
//     the ceiling is 69%.
//
// Cap table and traction are ONE field with an OR, not two. That is a
// deliberate deviation from the brief's wording, and the reason is
// constraint (d): Krohnsty has a deck and a cap table but no traction, and
// as two separate fields it would have fallen from 100% to ~78% for
// something it was never asked for. As one field it lands at 95% — a real
// profile with deck + cap table loses a few points, not twenty. A founder
// with both still gains through the Vault-depth and business-plan fields.
import type { CompanyPerson, Org } from './types';
import {
  hasDocumentForBonus, DECK_BONUS_FOLDERS, DECK_BONUS_KEYWORDS,
  BUSINESS_PLAN_BONUS_FOLDERS, BUSINESS_PLAN_BONUS_KEYWORDS,
} from './pipeline-unlock';

// What the founder has actually put in, as opposed to typed into a form.
// Passed in rather than read here: this module stays pure and synchronous,
// and every caller already has these rows in hand (the store client-side,
// a bulk query server-side).
export interface CompletenessEvidence {
  // name + the name of the folder it sits in, so a deck is recognised by
  // WHERE it is as well as what it is called — reuses Prompt 536 §4's own
  // matcher rather than a second copy of that rule.
  documents: { name: string; folderName: string | null }[];
  capTableRows: number;
  tractionRows: number;
}

export const EMPTY_EVIDENCE: CompletenessEvidence = { documents: [], capTableRows: 0, tractionRows: 0 };

export interface CompletenessField {
  id: string;
  label: string;
  weight: number;
  // Which card owns this field, so the bar can scroll to the right one
  // even before the field itself is mounted/visible.
  card: 'identity' | 'team' | 'round' | 'vault';
  // Prompt 542 §2 — evidence fields have no input on this page to scroll
  // to; the bar sends the founder to the page that does.
  href?: string;
  isFilled: (org: Org, people: CompanyPerson[], evidence: CompletenessEvidence) => boolean;
}

// Fields only counted while a round is actually being raised (round_raising
// !== false). Deliberately unchanged by the rebalance.
const ROUND_ONLY_WHILE_RAISING = new Set([
  'round.stage', 'round.target', 'round.instruments', 'round.use_of_funds', 'round.target_close_date', 'round.runway',
]);

// Prompt 542 §2 — the exact set /api/provision-org writes at registration,
// including the four Prompt 539 adds. Exported so the test that pins the
// "a fresh signup is ≤8%" promise reads from the same list this file
// scores, instead of a hand-copied one that could drift.
export const SIGNUP_FILLED_FIELD_IDS = [
  'identity.name', 'identity.website', 'identity.country', 'identity.sectors', 'identity.one_liner',
  'round.stage', 'round.target',
  'team.people', 'team.founder', 'team.primary_contact',
] as const;

const DECK_WEIGHT = 46;
const NUMBERS_WEIGHT = 46;

export const COMPLETENESS_FIELDS: CompletenessField[] = [
  // --- Registration fills these. Table stakes, weight 1 each. ---
  { id: 'identity.name', label: 'Commercial name', weight: 1, card: 'identity', isFilled: (o) => !!o.name?.trim() },
  { id: 'identity.website', label: 'Website', weight: 1, card: 'identity', isFilled: (o) => !!o.website?.trim() },
  { id: 'identity.country', label: 'HQ country', weight: 1, card: 'identity', isFilled: (o) => !!o.country?.trim() },
  { id: 'identity.sectors', label: 'Sector / vertical', weight: 1, card: 'identity', isFilled: (o) => (o.sectors?.length ?? 0) > 0 || !!o.sectors_other },
  { id: 'identity.one_liner', label: 'One-liner', weight: 1, card: 'identity', isFilled: (o) => !!o.one_liner?.trim() },
  { id: 'round.stage', label: 'Stage', weight: 1, card: 'round', isFilled: (o) => !!o.stage },
  { id: 'round.target', label: 'Amount to raise', weight: 1, card: 'round', isFilled: (o) => o.round_target_eur != null },
  { id: 'team.people', label: 'At least one team member', weight: 1, card: 'team', isFilled: (_o, p) => p.length > 0 },
  { id: 'team.founder', label: 'At least one founder marked', weight: 1, card: 'team', isFilled: (_o, p) => p.some((x) => x.is_founder) },
  // A real FK into company_people, checked for both "is it set" AND "does
  // it still point at a real team member".
  { id: 'team.primary_contact', label: 'Primary contact', weight: 1, card: 'team', isFilled: (o, p) => !!o.primary_contact_person_id && p.some((x) => x.id === o.primary_contact_person_id) },

  // --- The founder has to sit down and write these. ---
  { id: 'identity.legal_name', label: 'Legal name', weight: 4, card: 'identity', isFilled: (o) => !!o.legal_name?.trim() },
  { id: 'identity.hq_city', label: 'HQ city', weight: 2, card: 'identity', isFilled: (o) => !!o.hq_city?.trim() },
  { id: 'identity.founded_year', label: 'Year founded', weight: 2, card: 'identity', isFilled: (o) => !!o.founded_year },
  { id: 'identity.description', label: 'Short description', weight: 4, card: 'identity', isFilled: (o) => !!o.description?.trim() },
  // The intro pitch (Prompt 325) is exactly what an investor sees at
  // Level 0. "Mini-pitch generated & activated" is still NOT here on
  // purpose — that state lives in org_mini_pitches, a table this function
  // has no access to; MiniPitchCard surfaces it instead.
  { id: 'identity.intro_pitch', label: 'Intro pitch (problem & solution)', weight: 5, card: 'identity', isFilled: (o) => !!o.intro_problem?.trim() && !!o.intro_solution?.trim() },
  { id: 'identity.logo', label: 'Logo', weight: 1, card: 'identity', isFilled: (o) => !!o.logo_url },
  { id: 'identity.postal_code', label: 'Postal code', weight: 1, card: 'identity', isFilled: (o) => !!o.postal_code?.trim() },
  // Product/company maturity, NOT the round's stage (a different question).
  { id: 'identity.current_phase', label: 'Current phase', weight: 3, card: 'identity', isFilled: (o) => !!o.current_phase },
  { id: 'identity.revenue', label: 'Revenue', weight: 3, card: 'identity', isFilled: (o) => o.revenue_eur != null },
  { id: 'team.employee_count', label: 'Employee count', weight: 1, card: 'team', isFilled: (o) => o.employee_count != null },
  { id: 'round.raising', label: 'Raising now? answered', weight: 2, card: 'round', isFilled: (o) => o.round_raising != null },
  { id: 'round.instruments', label: 'Instrument type', weight: 2, card: 'round', isFilled: (o) => (o.round_instruments?.length ?? 0) > 0 },
  { id: 'round.use_of_funds', label: 'Use of funds', weight: 3, card: 'round', isFilled: (o) => !!o.round_use_of_funds?.trim() },
  { id: 'round.target_close_date', label: 'Target close date', weight: 1, card: 'round', isFilled: (o) => !!o.round_target_close_date },
  { id: 'round.runway', label: 'Runway', weight: 1, card: 'round', isFilled: (o) => o.round_runway_months != null },

  // --- Evidence. What an investor actually opens. ---
  {
    id: 'vault.deck', label: 'Investor or pitch deck in your Vault', weight: DECK_WEIGHT, card: 'vault', href: '/documents',
    isFilled: (_o, _p, e) => hasDocumentForBonus(e.documents, DECK_BONUS_FOLDERS, DECK_BONUS_KEYWORDS),
  },
  {
    // One field, one OR — see this file's header for why this is not two.
    id: 'vault.numbers', label: 'Cap table or traction metrics', weight: NUMBERS_WEIGHT, card: 'vault', href: '/settings',
    isFilled: (_o, _p, e) => e.capTableRows > 0 || e.tractionRows > 0,
  },
  {
    id: 'vault.business_plan', label: 'Business plan or financials in your Vault', weight: 8, card: 'vault', href: '/documents',
    isFilled: (_o, _p, e) => hasDocumentForBonus(e.documents, BUSINESS_PLAN_BONUS_FOLDERS, BUSINESS_PLAN_BONUS_KEYWORDS),
  },
  {
    id: 'vault.depth', label: 'At least 3 documents in your Vault', weight: 5, card: 'vault', href: '/documents',
    isFilled: (_o, _p, e) => e.documents.length >= 3,
  },
];

export interface CompletenessResult {
  pct: number;
  missing: CompletenessField[];
}

export function calcCompanyCompleteness(
  org: Org, people: CompanyPerson[], evidence: CompletenessEvidence = EMPTY_EVIDENCE,
): CompletenessResult {
  const raisingNow = org.round_raising !== false; // true or unanswered both keep round fields in scope
  const applicable = COMPLETENESS_FIELDS.filter((f) => raisingNow || !ROUND_ONLY_WHILE_RAISING.has(f.id));

  const totalWeight = applicable.reduce((s, f) => s + f.weight, 0);
  const missing = applicable.filter((f) => !f.isFilled(org, people, evidence));
  const filledWeight = totalWeight - missing.reduce((s, f) => s + f.weight, 0);
  const pct = totalWeight ? Math.round((filledWeight / totalWeight) * 100) : 0;

  return { pct, missing };
}

// Convenience for the three client call sites, which hold documents and
// folders as separate store collections.
export function evidenceFromStore(params: {
  documents: { name: string; folder_id?: string | null }[];
  folders: { id: string; name: string }[];
  capTableEntries: unknown[];
  tractionMetrics: unknown[];
}): CompletenessEvidence {
  const folderNameById = new Map(params.folders.map((f) => [f.id, f.name]));
  return {
    documents: params.documents.map((d) => ({
      name: d.name,
      folderName: d.folder_id ? folderNameById.get(d.folder_id) ?? null : null,
    })),
    capTableRows: params.capTableEntries.length,
    tractionRows: params.tractionMetrics.length,
  };
}
