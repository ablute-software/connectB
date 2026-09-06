// IRM_SPEC §6b-1 — completeness score. Pure functions; weights are a
// reasonable first cut (no field is authoritative over another), not a
// tuned model — revisit once real usage shows which gaps actually matter.
//
// Split into two dimensions (see DECISIONS.md, follow-up to cc11161):
// mixing firmographic fields (mature across the base, ~69% avg) with
// direct-research contact fields (still ~8% avg, only 45 entities touched
// by the direct-research batches so far) into one score produced a single
// number that didn't describe either group. FIRMOGRAPHIC_FIELDS keeps the
// original 6 checks and ENRICHMENT_THRESHOLD (70) untouched — same
// calibration, same ~203 candidates as before the contact fields existed.
// CONTACT_FIELDS is the new group; it does NOT get its own percent
// threshold (any reasonable cutoff selects almost the whole base while
// contact-field coverage is this early) — instead
// `qualifiesForContactEnrichment` encodes the actionable rule: a profile
// that's already firmographically solid (>=70%) but has ZERO contact
// fields is worth chasing; one that's incomplete on both fronts isn't a
// distinct queue item, it's just the firmographic queue.
import type { Entity, Person } from './types';

export const ENRICHMENT_THRESHOLD = 70;
export const ENRICHMENT_REQUEST_FIELD = '__enrichment_request__';

export interface CompletenessResult {
  percent: number;
  missing: string[];
}

export interface EntityCompletenessResult {
  firmographic: CompletenessResult;
  contact: CompletenessResult;
}

function score(checks: [boolean, string][]): CompletenessResult {
  const missing = checks.filter(([ok]) => !ok).map(([, label]) => label);
  return { percent: Math.round(((checks.length - missing.length) / checks.length) * 100), missing };
}

export function entityCompleteness(e: Entity): EntityCompletenessResult {
  const firmographic = score([
    [!!e.website, 'website'],
    [!!e.email_domain, 'contact email domain'],
    [!!e.thesis, 'thesis'],
    [e.check_min_eur != null && e.check_max_eur != null, 'check size'],
    [e.stage_min != null && e.stage_max != null, 'stage range'],
    [e.sectors.length > 0, 'sectors'],
  ]);
  const contact = score([
    [!!e.email, 'email'],
    [!!e.phone, 'phone'],
    [!!e.address, 'address'],
    [!!e.postal_code, 'postal code'],
    [!!e.key_people, 'key people'],
  ]);
  return { firmographic, contact };
}

// Actionable contact-enrichment rule (founder-specified): only flag
// profiles worth chasing — already firmographically qualified, but with
// no contact data at all. A profile incomplete on both fronts just needs
// the firmographic queue; flagging every zero-contact row regardless of
// firmographic status would reproduce the same "signal that fires on 94%
// of the base isn't a signal" problem the split was meant to fix.
export function qualifiesForContactEnrichment(c: EntityCompletenessResult): boolean {
  return c.firmographic.percent >= ENRICHMENT_THRESHOLD && c.contact.percent === 0;
}

// Prompt 276 — "Added by startups" completeness grade (A-E), so the
// backoffice reviewer can approve the richest rows first. Deliberately a
// SEPARATE function from entityCompleteness, not a reuse: the manual-
// entities route returns a different shape (ManualEntity, page-local to
// queue/page.tsx — camelCase, a JSON projection, not the full Entity row)
// AND a different field list (this checks hqCity/hqCountry/geographies,
// which entityCompleteness never checks at all; and treats stage
// min/max and check min/max as four independent equal-weight checks,
// where entityCompleteness collapses each pair into one "range" check).
// Kept structural rather than importing ManualEntity from the app layer,
// so this module stays a leaf lib/ has no reason to import from app/.
//
// Cutoffs measured against the real 757 rows before fixing them (2026-08-
// 19): A>=80 (58 rows, 7.7%), B>=60 (288, 38.0%), C>=40 (213, 28.1%),
// D>=20 (98, 12.9%), E<20 (100, 13.2%) — no bucket is degenerate, kept as
// proposed. The 38%-in-B / 28%-in-C sizes are a property of the data (most
// manually-added rows cluster at exactly 70% or 50% complete, from a
// handful of distinct entry patterns), not a fixable cutoff artifact —
// every alternative boundary tried lands the same two clusters in one
// bucket or another, never split more evenly.
export type CompletenessGrade = 'A' | 'B' | 'C' | 'D' | 'E';

export function gradeFromPercent(percent: number): CompletenessGrade {
  if (percent >= 80) return 'A';
  if (percent >= 60) return 'B';
  if (percent >= 40) return 'C';
  if (percent >= 20) return 'D';
  return 'E';
}

export interface ManualEntityCompletenessFields {
  website: string | null; hqCity: string | null; hqCountry: string | null;
  geographies: string[] | null; stageMin: string | null; stageMax: string | null;
  checkMinEur: number | null; checkMaxEur: number | null; sectors: string[]; contactCount: number;
}

export function manualEntityCompleteness(f: ManualEntityCompletenessFields): CompletenessResult & { grade: CompletenessGrade } {
  const result = score([
    [!!f.website, 'website'],
    [!!f.hqCity, 'HQ city'],
    [!!f.hqCountry, 'HQ country'],
    [(f.geographies?.length ?? 0) > 0, 'geographies'],
    [!!f.stageMin, 'stage min'],
    [!!f.stageMax, 'stage max'],
    [f.checkMinEur != null, 'check min'],
    [f.checkMaxEur != null, 'check max'],
    [f.sectors.length > 0, 'sectors'],
    [f.contactCount > 0, 'contacts'],
  ]);
  return { ...result, grade: gradeFromPercent(result.percent) };
}

// Prompt 595 §C — the catalog-side facts a linked catalog_people/
// catalog_people_research row can supply for the SAME real person. Optional
// on purpose: the founder-facing page (people/[id]/page.tsx) calls
// personCompleteness with one argument and must keep meaning "does MY OWN
// record have this filled in" — a founder has no visibility into the
// catalog, and their own outreach still needs their own copy of the field
// regardless of what the platform separately knows. Only the backoffice's
// admin-side "is this genuinely unknown to the platform" question (the
// enrichment queue, deciding whether to spend AI research on it) should
// traverse catalog_person_id — so it's an opt-in second argument, not a
// change to what the single-argument call means.
export interface PersonCatalogSide {
  linkedin_url?: string | null;
  hook?: string | null;
  background?: string | null;
  email_verified?: string | null;
  email_guess?: string | null;
}

export function personCompleteness(p: Person, catalogSide?: PersonCatalogSide | null): CompletenessResult {
  const checks: [boolean, string][] = [
    [!!p.linkedin_url || !!catalogSide?.linkedin_url, 'LinkedIn'],
    [!!p.email_verified || !!p.email_guess || !!catalogSide?.email_verified || !!catalogSide?.email_guess, 'email'],
    [!!p.phone, 'phone'],
    [!!p.role, 'role'],
    [!!p.hook || !!catalogSide?.hook, 'hook / outreach angle'],
    [!!p.background || !!catalogSide?.background, 'background'],
  ];
  return score(checks);
}
