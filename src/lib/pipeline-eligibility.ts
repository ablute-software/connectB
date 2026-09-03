// Prompt 556 §B — the pure core of "which startups may an investor discover".
//
// This REVERSES Prompt 184, deliberately and with Nuno's own reason. 184
// dropped matchdeal_profiles.is_visible from this decision and put the
// FOUNDER's CRM profile gate (isProfileGateComplete — the nine fields that
// unlock the founder's own Pipeline) in its place, because Caramel Biscuit
// was permanently invisible to investors purely for never having opened the
// MatchDeal app. That fixed one symptom and created a worse one: the gate is
// a founder-side unlock, not a publication act, so a startup appeared in
// every investor's Pipeline the moment it filled in its own CRM — with no
// one ever choosing to be seen. Two things that made it undeniable, both
// live on 03/09/2026:
//
//   * Krohnsty 54f1bf67 — the account was DELETED. Deleting the auth user
//     cascaded org_members and nothing else, so the org kept all nine gate
//     fields and kept being served to investors as a discovery card, with
//     all its data, after it stopped existing.
//   * Krohnsty 70a354f2, Sherlock Deal, Estojo, Caramel Biscuit — all with
//     is_visible = false, all being shown "Investors can't find you yet"
//     (Prompt 543) on their own About tab while investors could, in fact,
//     find them. The product was telling the founder the opposite of what
//     it was doing.
//
// So eligibility goes back to what Prompt 120's own header comment always
// claimed it was and what Prompt 125 decided it should be — visibility to
// investors is an explicit founder act. is_visible is that act: the
// trg_matchdeal_profile_completeness trigger derives it as `is_complete and
// owner_suspended_at is null and platform_suspended_at is null`, so it is
// true exactly when a founder has filled in their MatchDeal profile and has
// not hidden themselves. The CRM profile gate stays where it belongs — the
// founder's own pipeline unlock (pipeline-unlock.ts), which this file no
// longer reads at all.
//
// Caramel Biscuit's original symptom is therefore back BY DESIGN: an org
// that never opens MatchDeal is not discoverable. That is now the intended
// answer, not a bug to re-fix — its About tab says exactly that, and
// clicking Publish is what changes it.
//
// Pure on purpose: no Supabase client, no capability probe, no `import
// 'server-only'` — the caller does the two reads, this decides. Every rule
// below is unit-tested in pipeline-eligibility.test.ts.

export type EligibilityOrg = {
  id: string;
  // Prompt 556 §A. Absent (not just null) on an environment where migration
  // 0303 hasn't been applied — `undefined` reads as "not closed", which is
  // the correct degrade: closing is a new state, nothing was closed before.
  closed_at?: string | null;
  // Migration 0139. Same absent-means-false degrade.
  is_test?: boolean | null;
  // Migration 0168, dual-written by /api/company/visibility.
  owner_suspended_at?: string | null;
  platform_suspended_at?: string | null;
};

export type EligibilityStartupProfile = {
  membership_id: string;
  is_visible?: boolean | null;
  owner_suspended_at?: string | null;
  platform_suspended_at?: string | null;
};

export function filterEligibleOrgs(
  orgs: EligibilityOrg[],
  startupProfiles: EligibilityStartupProfile[],
  viewerIsTest: boolean,
): string[] {
  const profileByOrg = new Map(startupProfiles.map((p) => [p.membership_id, p]));
  return orgs
    .filter((org) => {
      if (org.closed_at) return false;
      // Suspension is checked from BOTH sources, unchanged from Prompt 184
      // §2: orgs (the source this function reads going forward) AND the
      // matchdeal_profiles copy the toggle route still dual-writes, so
      // nothing suspended before 0168 landed can silently reappear.
      if (org.owner_suspended_at || org.platform_suspended_at) return false;
      // Prompt 07/08 visibilidade simétrica — is_test is a COHORT, not
      // censorship: a test viewer sees test + real, a real viewer sees real
      // only. Folded in here from the old excludeTestOrgIds() round-trip:
      // the caller already selects the whole org row, so this needed neither
      // a second query nor its own capability probe.
      if (!viewerIsTest && org.is_test === true) return false;
      const profile = profileByOrg.get(org.id);
      // No startup MatchDeal profile at all = never published. Fail closed:
      // an absent row is not an implicit yes.
      if (!profile) return false;
      if (profile.owner_suspended_at || profile.platform_suspended_at) return false;
      return profile.is_visible === true;
    })
    .map((org) => org.id);
}
