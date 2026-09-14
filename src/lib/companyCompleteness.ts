// Company tab redesign — "Profile Strength" completeness engine (v0.3),
// applied first to the founder side. ONE constant, ONE calculation
// function — nothing about the % lives anywhere else. Honest by design:
// weights favour essentials (legal identity, the team, the round's
// headline numbers) over decoration (photo, postal code), and when the
// founder isn't currently raising, the round-specific fields drop out of
// the denominator entirely rather than dragging the score down for
// something genuinely not applicable.
import type { CompanyPerson, Org } from './types';

export interface CompletenessField {
  id: string;
  label: string;
  weight: number;
  // Which card owns this field, so the bar can scroll to the right one
  // even before the field itself is mounted/visible.
  card: 'identity' | 'team' | 'round';
  isFilled: (org: Org, people: CompanyPerson[]) => boolean;
}

// Fields only counted while a round is actually being raised (round_raising
// !== false). photo_url/bio are deliberately absent — optional decoration,
// per spec, counts for nothing.
const ROUND_ONLY_WHILE_RAISING = new Set([
  'round.stage', 'round.target', 'round.instruments', 'round.use_of_funds', 'round.target_close_date', 'round.runway',
]);

// Prompt 894 §B — reweighted (2026-09-14). name/website/country/one_liner/
// stage/round.target are exactly the six fields the SIGNUP FORM itself
// captures (provision-org/route.ts) — a founder who has done nothing but
// sign up already has all six, for free, before ever opening this page.
// Confirmed live: Wisify Tech Solutions (zero team members, no description,
// no legal identity, nothing touched past signup) showed "34% complete"
// under the old weights (8+5+5+8+6+8=40 of 119) — a founder's own
// complaint that the number read as far more built-out than reality.
// These six now carry only a token weight (1 each, the "you answered a
// form field" tier); the 34 points that frees up are redistributed
// proportionally across every OTHER field (×1.4304, the exact factor that
// keeps the 119-point total unchanged) — fields that genuinely require
// returning to Settings after signup (team roster, legal identity, sectors,
// description, intro pitch, round depth) now weigh more, in the same
// relative order as before. Re-run against ablute_'s real (near-complete)
// row before shipping: 97% under the old weights, 97% under these — no
// regression for the one org that's actually this far along. The separate
// pipeline-unlock 70% gate does NOT read this score (Prompt 536 §1 moved it
// to its own fixed nine-field isProfileGateComplete check specifically
// because this weighted score was too unstable to gate on) — the only
// consumers left are the displayed bar, the "reached 80%" analytics
// milestone, and a backoffice display column, all cosmetic/informational.
export const COMPLETENESS_FIELDS: CompletenessField[] = [
  // Identity — the essentials weigh most.
  { id: 'identity.legal_name', label: 'Legal name', weight: 11, card: 'identity', isFilled: (o) => !!o.legal_name?.trim() },
  { id: 'identity.name', label: 'Commercial name', weight: 1, card: 'identity', isFilled: (o) => !!o.name?.trim() },
  { id: 'identity.website', label: 'Website', weight: 1, card: 'identity', isFilled: (o) => !!o.website?.trim() },
  { id: 'identity.country', label: 'HQ country', weight: 1, card: 'identity', isFilled: (o) => !!o.country?.trim() },
  { id: 'identity.hq_city', label: 'HQ city', weight: 4, card: 'identity', isFilled: (o) => !!o.hq_city?.trim() },
  { id: 'identity.founded_year', label: 'Year founded', weight: 4, card: 'identity', isFilled: (o) => !!o.founded_year },
  { id: 'identity.sectors', label: 'Sector / vertical', weight: 9, card: 'identity', isFilled: (o) => (o.sectors?.length ?? 0) > 0 || !!o.sectors_other },
  { id: 'identity.one_liner', label: 'One-liner', weight: 1, card: 'identity', isFilled: (o) => !!o.one_liner?.trim() },
  { id: 'identity.description', label: 'Short description', weight: 7, card: 'identity', isFilled: (o) => !!o.description?.trim() },
  // Prompt 339 §C — the intro pitch (325) is exactly what an investor sees
  // at Level 0, the same completeness-bar visibility tier as one_liner
  // above; "Mini-pitch generated & activated" is NOT added here on
  // purpose — that state lives in org_mini_pitches, a separate table this
  // function has no access to (it only ever reads `Org`/`CompanyPerson`),
  // so folding it into this synchronous score would mean either a new
  // async signature here or a stale/wrong bar. MiniPitchCard.tsx already
  // surfaces the equivalent "what's missing" via checkMiniPitchGate's own
  // labels+hrefs — that's this feature's real home, not this bar.
  { id: 'identity.intro_pitch', label: 'Intro pitch (problem & solution)', weight: 9, card: 'identity', isFilled: (o) => !!o.intro_problem?.trim() && !!o.intro_solution?.trim() },
  { id: 'identity.logo', label: 'Logo', weight: 3, card: 'identity', isFilled: (o) => !!o.logo_url },
  { id: 'identity.postal_code', label: 'Postal code', weight: 1, card: 'identity', isFilled: (o) => !!o.postal_code?.trim() },
  // Prompt 85 Correction 1 — product/company maturity, NOT the round's
  // stage (that's identity's sibling round.stage, a different question).
  { id: 'identity.current_phase', label: 'Current phase', weight: 6, card: 'identity', isFilled: (o) => !!o.current_phase },
  { id: 'identity.revenue', label: 'Revenue', weight: 4, card: 'identity', isFilled: (o) => o.revenue_eur != null },

  // Team — having a team at all matters much more than headcount precision.
  { id: 'team.people', label: 'At least one team member', weight: 14, card: 'team', isFilled: (_o, p) => p.length > 0 },
  { id: 'team.founder', label: 'At least one founder marked', weight: 9, card: 'team', isFilled: (_o, p) => p.some((x) => x.is_founder) },
  { id: 'team.employee_count', label: 'Employee count', weight: 3, card: 'team', isFilled: (o) => o.employee_count != null },
  // Prompt 85 Correction 1 — a real FK into company_people, checked here
  // for both "is it set" AND "does it still point at a real team member"
  // (a removed person leaves this null via the FK's own ON DELETE SET NULL,
  // but a stale value should never silently count as filled either way).
  { id: 'team.primary_contact', label: 'Primary contact', weight: 6, card: 'team', isFilled: (o, p) => !!o.primary_contact_person_id && p.some((x) => x.id === o.primary_contact_person_id) },

  // Round — 'raising?' itself always counts; the rest only while raising.
  { id: 'round.raising', label: 'Raising now? answered', weight: 7, card: 'round', isFilled: (o) => o.round_raising != null },
  { id: 'round.stage', label: 'Stage', weight: 1, card: 'round', isFilled: (o) => !!o.stage },
  { id: 'round.target', label: 'Amount to raise', weight: 1, card: 'round', isFilled: (o) => o.round_target_eur != null },
  { id: 'round.instruments', label: 'Instrument type', weight: 6, card: 'round', isFilled: (o) => (o.round_instruments?.length ?? 0) > 0 },
  { id: 'round.use_of_funds', label: 'Use of funds', weight: 4, card: 'round', isFilled: (o) => !!o.round_use_of_funds?.trim() },
  { id: 'round.target_close_date', label: 'Target close date', weight: 3, card: 'round', isFilled: (o) => !!o.round_target_close_date },
  { id: 'round.runway', label: 'Runway', weight: 3, card: 'round', isFilled: (o) => o.round_runway_months != null },
];

export interface CompletenessResult {
  pct: number;
  missing: CompletenessField[];
}

export function calcCompanyCompleteness(org: Org, people: CompanyPerson[]): CompletenessResult {
  const raisingNow = org.round_raising !== false; // true or unanswered (null/undefined) both keep round fields in scope
  const applicable = COMPLETENESS_FIELDS.filter((f) => raisingNow || !ROUND_ONLY_WHILE_RAISING.has(f.id));

  const totalWeight = applicable.reduce((s, f) => s + f.weight, 0);
  const missing = applicable.filter((f) => !f.isFilled(org, people));
  const filledWeight = totalWeight - missing.reduce((s, f) => s + f.weight, 0);
  const pct = totalWeight ? Math.round((filledWeight / totalWeight) * 100) : 0;

  return { pct, missing };
}
