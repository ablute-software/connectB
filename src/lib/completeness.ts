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

export function personCompleteness(p: Person): CompletenessResult {
  const checks: [boolean, string][] = [
    [!!p.linkedin_url, 'LinkedIn'],
    [!!p.email_verified || !!p.email_guess, 'email'],
    [!!p.phone, 'phone'],
    [!!p.role, 'role'],
    [!!p.hook, 'hook / outreach angle'],
    [!!p.background, 'background'],
  ];
  return score(checks);
}
