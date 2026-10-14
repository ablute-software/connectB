// Prompt 907 (I2/I3) — the unit a call's application limit is counted on (spec §5.1): one per project/startup (the default) or one per
// legal entity. Pure. The key is stored on the application when it is created, so what was counted then is what counts later, whatever
// happens to the startup's profile.
//
// "Project / startup" = the startup account itself (a project without a company is a startup account like any other: nothing
// business-specific is required of it). "Legal entity" = the company behind it: the platform has no tax number for a startup yet,
// so for now it is the legal name (or, failing that, the name) together with the country, compared without case or punctuation.
// Two accounts of the same company with the same legal name and country therefore count as one unit. Known limit, recorded in the report.
import type { LimitUnit } from '../types';

const norm = (s: unknown): string => (typeof s === 'string' ? s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '') : '');

export function unitKey(limitUnit: LimitUnit, org: { id: string; name?: unknown; legal_name?: unknown; country?: unknown }): string {
  if (limitUnit === 'legal_entity') {
    const name = norm(org.legal_name) || norm(org.name);
    // Nothing to compare by: fall back to the account itself rather than lumping unrelated startups together.
    return name ? `legal:${name}|${norm(org.country)}` : `org:${org.id}`;
  }
  return `org:${org.id}`;
}
