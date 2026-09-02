// Prompt 543 §A — the rule behind "Incomplete — not visible yet", and the
// mapping that lets a founder get out of it.
//
// THE BUG, in two sentences: no code path has ever created a
// `matchdeal_profiles` row of kind 'startup' — one insert exists in the
// whole history and it is kind 'investor' — so every org created after the
// four hand-made prototypes had no row at all. `/api/company/visibility`
// then reported `isComplete: false` with an EMPTY `missingFields` (it only
// filled that list `if (profile)`), the UI rendered `[].join(', ') || '…'`
// as literally "…", and its one call to action pointed at /pair, whose own
// no-profile screen pointed straight back at the website. A closed loop
// with nine production orgs inside it, including every real founder since
// August.
//
// WHAT THIS MODULE IS NOT: an auto-publisher. Prompt 125 Block B rejected
// schema-level auto-sync deliberately — becoming visible to investors is an
// act the founder performs, not a side effect of filling in a form. The row
// now always exists, but it is created EMPTY, so `is_complete` (and with it
// `is_visible`, via migration 0105's trigger) stays false until the founder
// presses Publish. What changes is that "not published" is now a state with
// a button, instead of a dead end with an ellipsis in it.
import type { Org } from './types';

// The seven fields migration 0105's trigger requires of a startup profile,
// each paired with the org field it is copied from and the About-card
// anchor the founder can be sent to. The ids are the completeness bar's own
// (`COMPLETENESS_FIELDS`), so the existing flash/scroll mechanism works
// without a second vocabulary.
export interface MatchdealRequirement {
  profileColumn: 'photo_url' | 'website' | 'sectors' | 'description' | 'country' | 'investment_stage_sought' | 'company_phase';
  label: string;
  fieldId: string;
  isPresent: (org: Org) => boolean;
}

export const MATCHDEAL_STARTUP_REQUIREMENTS: MatchdealRequirement[] = [
  { profileColumn: 'photo_url', label: 'Logo', fieldId: 'identity.logo', isPresent: (o) => !!o.logo_url },
  { profileColumn: 'website', label: 'Website', fieldId: 'identity.website', isPresent: (o) => !!o.website?.trim() },
  { profileColumn: 'sectors', label: 'Sector / vertical', fieldId: 'identity.sectors', isPresent: (o) => (o.sectors?.length ?? 0) > 0 },
  // Same fallback as computeProfilePrefill: a one-liner is a description
  // for this purpose, and a founder who wrote one should not be told they
  // have written nothing.
  { profileColumn: 'description', label: 'Short description', fieldId: 'identity.description', isPresent: (o) => !!(o.description?.trim() || o.one_liner?.trim()) },
  { profileColumn: 'country', label: 'HQ country', fieldId: 'identity.country', isPresent: (o) => !!o.country?.trim() },
  { profileColumn: 'investment_stage_sought', label: 'Stage', fieldId: 'round.stage', isPresent: (o) => !!o.stage },
  { profileColumn: 'company_phase', label: 'Current phase', fieldId: 'identity.current_phase', isPresent: (o) => !!o.current_phase },
];

export interface MatchdealMissingField { label: string; fieldId: string }

// Computed from the ORG, never from the profile. That is the whole
// correction: the old list was read off a row that did not exist, which is
// why it was always empty and always rendered as "…".
export function orgMatchdealMissing(org: Org): MatchdealMissingField[] {
  return MATCHDEAL_STARTUP_REQUIREMENTS
    .filter((r) => !r.isPresent(org))
    .map((r) => ({ label: r.label, fieldId: r.fieldId }));
}

// What the toggle and the banner show. Deliberately four states, not the
// old two: "not published" and "incomplete" were previously the same
// screen, and it said neither.
export type MatchdealStartupState =
  // The org itself is missing something a profile needs. Show the list.
  | 'incomplete'
  // Everything is there; the founder simply has not published yet.
  | 'unpublished'
  // Live to investors.
  | 'published'
  // Live-capable but switched off, by the founder or by the platform.
  | 'suspended';

export function matchdealStartupState(params: {
  isComplete: boolean;
  ownerSuspended: boolean;
  platformSuspended: boolean;
  orgMissing: MatchdealMissingField[];
}): MatchdealStartupState {
  // Suspension is a deliberate act on a profile that WAS publishable, so it
  // outranks the rest — a suspended profile must never read as "incomplete"
  // and send the founder off to fill in fields that are already filled.
  if (params.ownerSuspended || params.platformSuspended) return 'suspended';
  if (params.isComplete) return 'published';
  // Never 'incomplete' with an empty list. That combination is exactly the
  // "…" bug, and it is now unrepresentable: an org with nothing missing
  // that is not yet complete has simply not been published.
  return params.orgMissing.length > 0 ? 'incomplete' : 'unpublished';
}

// The columns a publish writes. `photoUrl` is resolved by the caller (it
// needs Storage to sign the org's logo path) — everything else is a pure
// copy, kept here so what publish does is readable in one place and
// testable without a database.
export interface MatchdealPublishPayload {
  photo_url: string | null;
  photo_storage_path: string | null;
  website: string | null;
  sectors: string[];
  description: string | null;
  country: string | null;
  investment_stage_sought: string | null;
  company_phase: string | null;
  entity_name: string | null;
}

export function matchdealPublishPayload(org: Org, photoUrl: string | null): MatchdealPublishPayload {
  return {
    photo_url: photoUrl,
    // The org's logo path, not a copy of the file: the image was already
    // magic-byte checked and VirusTotal-scanned when IdentityCard uploaded
    // it (uploadAndVerifyFile), and re-uploading it here would create a
    // second object to keep in sync for no gain.
    photo_storage_path: org.logo_url ?? null,
    website: org.website?.trim() || null,
    sectors: org.sectors ?? [],
    description: org.description?.trim() || org.one_liner?.trim() || null,
    country: org.country?.trim() || null,
    investment_stage_sought: org.stage ?? null,
    company_phase: org.current_phase ?? null,
    entity_name: org.name?.trim() || null,
  };
}
