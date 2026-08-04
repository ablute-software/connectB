// Prompt 125 Block B — pure prefill-merge logic, extracted so it's directly
// unit-testable without a live Supabase client. Form-LEVEL prefill only:
// this never writes anything by itself — it computes what the MatchDeal
// Profile form should show for still-empty fields, sourced from the
// startup's own org (Company tab) data. The founder's own explicit Save is
// what persists it. Schema-level auto-sync was rejected (migration 0115) —
// see ProfilePanel.tsx's own comment for why.
export interface ProfilePrefillInput {
  description: string | null;
  website: string | null;
  country: string | null;
}
export interface OrgPrefillSource {
  description: string | null;
  one_liner: string | null;
  website: string | null;
  country: string | null;
}

export function computeProfilePrefill(profile: ProfilePrefillInput, org: OrgPrefillSource): ProfilePrefillInput {
  return {
    description: profile.description || org.description || org.one_liner || null,
    website: profile.website || org.website || null,
    country: profile.country || org.country || null,
  };
}
