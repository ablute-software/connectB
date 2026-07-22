// IRM_SPEC §6b-1 — completeness score. Pure functions; weights are a
// reasonable first cut (no field is authoritative over another), not a
// tuned model — revisit once real usage shows which gaps actually matter.
import type { Entity, Person } from './types';

export const ENRICHMENT_THRESHOLD = 70;
export const ENRICHMENT_REQUEST_FIELD = '__enrichment_request__';

export interface CompletenessResult {
  percent: number;
  missing: string[];
}

export function entityCompleteness(e: Entity): CompletenessResult {
  const checks: [boolean, string][] = [
    [!!e.website, 'website'],
    [!!e.email_domain, 'contact email domain'],
    [!!e.thesis, 'thesis'],
    [e.check_min_eur != null && e.check_max_eur != null, 'check size'],
    [e.stage_min != null && e.stage_max != null, 'stage range'],
    [e.sectors.length > 0, 'sectors'],
  ];
  const missing = checks.filter(([ok]) => !ok).map(([, label]) => label);
  return { percent: Math.round(((checks.length - missing.length) / checks.length) * 100), missing };
}

export function personCompleteness(p: Person): CompletenessResult {
  const checks: [boolean, string][] = [
    [!!p.linkedin_url, 'LinkedIn'],
    [!!p.email_verified || !!p.email_guess, 'email'],
    [!!p.role, 'role'],
    [!!p.hook, 'hook / outreach angle'],
    [!!p.background, 'background'],
  ];
  const missing = checks.filter(([ok]) => !ok).map(([, label]) => label);
  return { percent: Math.round(((checks.length - missing.length) / checks.length) * 100), missing };
}
