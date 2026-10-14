// Prompt 907 (I2) — pre-filling an application from the platform's own data (spec §6.4, §13.5). Pure.
//
// Every field the editor explicitly LINKED to a platform datum (company name, country, the person's name and role, sector, stage,
// website) starts with that datum, editable. The rule that matters: a field the applicant edited is NEVER overwritten by the profile
// again — so pre-filling only ever fills a field that has no answer yet, and it runs once, when the draft is created. What the
// applicant typed (even an emptied field) is theirs from then on. The password has no place here: it never enters an application.
import { MAPPABLE_KINDS, PLATFORM_MAPPING_KEYS, type Answers, type FormField, type PlatformMappingKey } from '../types';

export type ProfileValues = Record<PlatformMappingKey, string>;

type Row = Record<string, unknown>;
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** The platform data of the applicant's startup and of the person, from the `orgs` and `org_members` rows. */
export function profileFromRows(org: Row | null | undefined, member: Row | null | undefined): ProfileValues {
  return {
    company_name: text(org?.name),
    country: text(org?.country),
    person_name: text(member?.full_name),
    person_role: text(member?.title),
    sector: text(org?.sector),
    stage: text(org?.stage),
    website: text(org?.website),
  };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** What a mapped field would start with, or null when the datum is empty or does not fit the field (a choice the datum is not one of). */
export function prefillValue(field: FormField, profile: ProfileValues): string | null {
  const key = field.platformMapping;
  if (!key || !PLATFORM_MAPPING_KEYS.includes(key) || !MAPPABLE_KINDS.includes(field.kind)) return null;
  const value = profile[key];
  if (!value) return null;
  if (field.kind === 'single_choice') {
    // The platform stores "pre_seed"; the call's option says "Pre-seed": compare without punctuation and case, by id or by label.
    const hit = field.options.find((o) => norm(o.id) === norm(value) || norm(o.label) === norm(value));
    return hit ? hit.id : null;
  }
  return value;
}

/**
 * Fill, from the profile, ONLY the mapped fields that have no answer at all. `existing` wins always: an answer — even an empty
 * string the applicant left on purpose — is never replaced.
 */
export function prefillAnswers(fields: FormField[], profile: ProfileValues, existing: Answers = {}): Answers {
  const out: Answers = { ...existing };
  for (const f of fields) {
    if (Object.prototype.hasOwnProperty.call(existing, f.id)) continue;
    const v = prefillValue(f, profile);
    if (v !== null) out[f.id] = v;
  }
  return out;
}
