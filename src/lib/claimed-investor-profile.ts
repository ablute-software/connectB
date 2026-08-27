// Prompt 407 §A — the gate deciding whether an entity's OWN declared
// investor profile should take display precedence over the platform's
// researched catalog data. Centralized here (mirrors the
// resolveInvestorPlanTierForProfile pattern from Prompt 402 —
// portal-access.ts — one function, every §B call site uses it, never its
// own copy of the rule) so the reads can't drift apart.
//
// Qualifying requires BOTH:
//   1. An APPROVED investor_entity_claims row for this catalog entity.
//   2. That claim's own claimant having a matchdeal_profiles row
//      (kind='investor') with is_complete = true.
//
// catalog_entities.verification_status = 'verified' is deliberately NOT
// used as the claim signal, even though it sounds like the obvious one —
// confirmed by reading every writer of that column
// (backoffice/investor-entity-claims/[id]/approve, backoffice/submissions/
// [id]/review, backoffice/investor-identity/{documents,entities}/[id]/review,
// backoffice/catalog/[id], seed.ts) that it's shared by at least three
// UNRELATED verification flows — a startup-submitted-catalog-entry
// review, an investor identity/KYC-style document check, and plain manual
// backoffice editing — none of which create a matchdeal_profiles row at
// all. Gating on that field alone would "qualify" entities with no
// declared profile behind them at all. investor_entity_claims.status
// ='approved' is the one signal that specifically means "this investor
// claimed, and was approved for, THIS entity."
import type { SupabaseClient } from '@supabase/supabase-js';

export interface ClaimedInvestorProfile {
  website: string | null;
  sectors: string[];
  description: string | null;
  ticketMinEur: number | null;
  ticketMaxEur: number | null;
  stagesInvested: string[];
  geographies: string[];
  contact: string | null;
  preferredContactChannel: string | null;
  representativeName: string | null;
  entityName: string | null;
}

// If an entity has more than one approved claimant (multiple people from
// the same firm each individually claimed it — allowed; nothing upstream
// merges or deduplicates them), the most recently updated COMPLETE
// profile among them wins. A documented choice, not one the prompt
// specifies (it speaks of "a membership" in the singular) — deterministic
// and simple rather than merging several people's declarations field by
// field.
export async function resolveClaimedInvestorProfile(admin: SupabaseClient, catalogEntityId: string): Promise<ClaimedInvestorProfile | null> {
  const { data: claims } = await admin.from('investor_entity_claims')
    .select('claimant_user_id').eq('catalog_entity_id', catalogEntityId).eq('status', 'approved');
  const claimantUserIds = [...new Set((claims ?? []).map((c) => c.claimant_user_id as string))];
  if (claimantUserIds.length === 0) return null;

  const { data: members } = await admin.from('matchdeal_investor_members')
    .select('id').eq('catalog_entity_id', catalogEntityId).in('user_id', claimantUserIds);
  const membershipIds = (members ?? []).map((m) => m.id as string);
  if (membershipIds.length === 0) return null;

  const { data: profile } = await admin.from('matchdeal_profiles')
    .select('website, sectors, description, ticket_min, ticket_max, stages_invested, geographies, contact, preferred_contact_channel, representative_name, entity_name')
    .in('membership_id', membershipIds).eq('kind', 'investor').eq('is_complete', true)
    .order('updated_at', { ascending: false }).limit(1).maybeSingle();
  if (!profile) return null;

  return {
    website: profile.website ?? null,
    sectors: profile.sectors ?? [],
    description: profile.description ?? null,
    ticketMinEur: profile.ticket_min != null ? Number(profile.ticket_min) : null,
    ticketMaxEur: profile.ticket_max != null ? Number(profile.ticket_max) : null,
    stagesInvested: profile.stages_invested ?? [],
    geographies: profile.geographies ?? [],
    contact: profile.contact ?? null,
    preferredContactChannel: profile.preferred_contact_channel ?? null,
    representativeName: profile.representative_name ?? null,
    entityName: profile.entity_name ?? null,
  };
}

// The field-by-field fallback rule every §B call site applies: declared
// wins when non-empty, researched otherwise. Two small pure functions
// (scalar vs. list) rather than one generic — a genuinely empty string
// ('' or whitespace) counts as "not declared" same as null/undefined, an
// empty array counts as "not declared" same as null/undefined; neither
// check makes sense applied to the other shape.
export function preferDeclaredValue<T extends string | number>(declared: T | null | undefined, researched: T | null | undefined): T | null {
  if (declared == null) return researched ?? null;
  if (typeof declared === 'string' && declared.trim() === '') return researched ?? null;
  return declared;
}

export function preferDeclaredList<T>(declared: T[] | null | undefined, researched: T[] | null | undefined): T[] {
  return declared && declared.length > 0 ? declared : (researched ?? []);
}
