// Prompt 901 — a person linked to the catalog shows the CATALOG's LinkedIn,
// not the org's own (possibly stale) copy. Real incident, 01/10/2026: Nina
// Capital's Dr. Marta G. Zanchi had `people.linkedin_url` = .../martagzanchi
// (wrong, from the 21/07 import, `linkedin_verified: true` on a flag the
// Jul-2026 import never actually earned) while `catalog_people.linkedin_url`
// = .../mgzanchi (right, from enrichment, 03/09). The bridge between the
// two never existed on any founder-facing surface — every one of them read
// `person.linkedin_url` directly. 313 other linked people have the SAME gap
// in the easier direction (the org's own field is simply empty while the
// catalog has a value) — see the backfill this prompt also runs.
//
// Deliberately NOT the same thing as Prompt 871 §E's `overlayForEmptyFields`
// (catalog-person-overlay.ts): that is a dismissible SUGGESTION, shown only
// when the org's own field is empty, specifically because showing one next
// to a value the org already declared would read as a correction — and for
// subjective/authored fields (hook, background, watch-outs) that is exactly
// right, the founder's own wording should never be silently second-guessed.
// LinkedIn is different in kind: it is a factual identifier the catalog's
// enrichment pipeline is specifically responsible for keeping correct, not
// something the founder authored — so here the catalog's value wins even
// when the org's own field is non-empty, per Nuno's own explicit rule
// (01/10/2026) and the standing root rule that LinkedIn is discovery, never
// proof (29/09/2026): nothing is fixed by having found the right URL except
// where it's actually shown.
import type { Person } from './types';

export interface CatalogPersonLinkedIn {
  linkedin_url: string | null;
  linkedin_verified: boolean;
}

export type LinkedInSource = 'catalog' | 'org' | 'none';

export interface ResolvedPersonLinkedIn {
  url: string | null;
  verified: boolean;
  source: LinkedInSource;
}

// §C — a `linkedin_verified: true` on the org's OWN row is only trustworthy
// when it came from a source that actually verifies a LinkedIn URL (a
// self-claim, an email confirmation, a backoffice check) — never from the
// 21/07 import, which set the flag unconditionally on every row it created
// regardless of whether anyone had looked at the link. Absent/unlisted
// data_source degrades to untrustworthy too (same reasoning as the known
// bad source: no recorded provenance is no better than a known-bad one) —
// never the inverse ("trust unless proven otherwise"), which is exactly the
// failure this prompt exists to close. Display-only: the column itself is
// never rewritten — see this prompt's own §C instruction.
const JULY_IMPORT_DATA_SOURCE = 'Fund site + public talks, Jul 2026';

export function isTrustworthyOrgVerifiedFlag(person: Pick<Person, 'linkedin_verified' | 'data_source'>): boolean {
  if (!person.linkedin_verified) return false;
  if (!person.data_source) return false;
  if (person.data_source === JULY_IMPORT_DATA_SOURCE) return false;
  return true;
}

/**
 * The one place a founder-facing surface decides which LinkedIn URL to show
 * for a person, and whether to badge it verified. `catalogPerson` is the
 * linked catalog_people row's own linkedin_url/linkedin_verified (look it up
 * via `db.catalogPeopleLinkedIn[person.catalog_person_id]` — demo mode's map
 * is always empty, so this degrades to the org's own value there, same as
 * before this prompt). Call this instead of reading `person.linkedin_url`/
 * `.linkedin_verified` directly on any surface a founder can see.
 */
export function personLinkedInUrl(
  person: Pick<Person, 'linkedin_url' | 'linkedin_verified' | 'data_source'>,
  catalogPerson?: CatalogPersonLinkedIn | null,
): ResolvedPersonLinkedIn {
  if (catalogPerson?.linkedin_url) {
    return { url: catalogPerson.linkedin_url, verified: !!catalogPerson.linkedin_verified, source: 'catalog' };
  }
  if (person.linkedin_url) {
    return { url: person.linkedin_url, verified: isTrustworthyOrgVerifiedFlag(person), source: 'org' };
  }
  return { url: null, verified: false, source: 'none' };
}

/**
 * For the handful of call sites that pass a whole Person into logic that
 * itself reads `.linkedin_url`/`.linkedin_verified` (relationship.ts's
 * `recommendChannel`, specifically) rather than calling `personLinkedInUrl`
 * directly: returns a shallow copy with those two fields overridden to the
 * resolved value, so that logic sees the same answer a display surface
 * would, without that logic itself needing to know about catalog people at
 * all. Never mutates `person`, and never written back to the store — this
 * is exactly as read-time-only as `personLinkedInUrl` itself.
 */
export function resolvedLinkedInAsPerson<T extends Pick<Person, 'linkedin_url' | 'linkedin_verified' | 'data_source'>>(
  person: T,
  catalogPerson?: CatalogPersonLinkedIn | null,
): T {
  const resolved = personLinkedInUrl(person, catalogPerson);
  return { ...person, linkedin_url: resolved.url ?? undefined, linkedin_verified: resolved.verified };
}
