// Prompt 850 §A — the pure core of "which startups may an investor discover".
//
// SUPERSEDES Prompt 556 §B. 556 made discovery require
// matchdeal_profiles.is_visible (the MatchDeal publish act). Measured in
// production on 04/09/2026, that collapsed every real investor's discovery
// list to a single card: of the six real startup orgs, five pass the
// founder profile gate and exactly one (ablute_) had ever clicked Publish.
// The plan sells "up to 10 qualified opportunities a month" and the
// platform was hiding four startups that exist, are complete, and are
// looking for money. Nuno's decision (04/09), verbatim: "Se a nossa base de
// dados de startups só tem X startups, todas essas X deveriam ser
// consideradas quando se calcula a pipeline da conta do investidor, sendo
// apresentadas as com maior match."
//
// So the unit of eligibility is THE ACCOUNT, not the MatchDeal profile:
//
//   * isProfileGateComplete(org) — the nine fields (pipeline-unlock.ts) the
//     founder already filled to unlock their own Pipeline. A startup that
//     has done that work is a real, complete, fundraising account.
//   * NOT closed (orgs.closed_at, migration 0305) — 556 §A stays exactly as
//     it was: a deleted/closed account never appears again.
//   * NOT suspended by its owner or the platform, on BOTH orgs and the
//     matchdeal_profiles copy — this is the founder's real opt-out, and
//     Prompt 850 §B is what finally makes that switch reachable to a
//     founder who never published on MatchDeal.
//   * NOT back-office suspended or deleted (orgs.moderation_status) — see
//     the block below.
//   * NOT excluded from discovery outright (orgs.discovery_excluded_reason,
//     Prompt 563) — the platform's own account inside its own marketplace.
//   * the is_test cohort rule, unchanged.
//
// What 556's own header argued — "visibility must be an explicit act" — is
// answered by §B, not by is_visible: the founder gets an always-available
// "Visible to investors" switch instead of an accidental one buried behind
// a MatchDeal publication they may never make. is_visible from here on
// governs the MatchDeal app surface (deck, swipes) and NOTHING else; this
// file no longer reads it.
//
// A missing matchdeal_profiles row no longer disqualifies either. The
// pipeline card is built from `orgs` (name, one_liner, sectors, stage,
// country, round_target_eur, …); the only profile-sourced field is the
// expanded `description` (investor-pipeline.ts), which already falls back
// to one_liner. An absent row is still fail-closed for the fields it
// carries — it simply no longer decides eligibility.
//
// THE HOLE, and it is the reason the is_visible requirement could not
// simply be deleted: when 850 was written, filterEligibleOrgs never read
// orgs.moderation_status at all. Live proof: Estojo was suspended from the
// back-office on 02/09 10:27 UTC (quarantine to 02/10, moderation_status =
// 'suspended', its founder cannot even log in) and was still admitted into a
// brand-new investor's discovery pipeline on 04/09 at 09:03. Dropping
// is_visible without closing that would have handed suspended accounts back
// to investors — the same class of bug 556 §A was written to close.
//
// It is closed, by Prompt 571's check below, which landed on `main` from a
// parallel session while 850 was in flight. 850 §A had asked for
// isVisibleToOthers (account-moderation.ts) instead, which ALSO expires a
// time-boxed suspension on its own. Nuno chose 571's strict form when the
// two were landed together on 07/09 — see the check itself for what that
// costs and how to revisit it.
//
// Pure on purpose: no Supabase client, no capability probe, no `import
// 'server-only'` — the caller does the two reads, this decides. Every rule
// below is unit-tested in pipeline-eligibility.test.ts.
import { isProfileGateComplete, type ProfileGateOrg } from './pipeline-unlock';

export type EligibilityOrg = ProfileGateOrg & {
  id: string;
  // Prompt 556 §A. Absent (not just null) on an environment where migration
  // 0305 hasn't been applied — `undefined` reads as "not closed", which is
  // the correct degrade: closing is a new state, nothing was closed before.
  closed_at?: string | null;
  // Migration 0139. Same absent-means-false degrade.
  is_test?: boolean | null;
  // Migration 0168, dual-written by /api/company/visibility.
  owner_suspended_at?: string | null;
  platform_suspended_at?: string | null;
  // Prompt 563, migration 0311. Non-null = never listed to investors, whatever
  // the profile says. Same absent-means-allowed degrade as the fields above.
  discovery_excluded_reason?: string | null;
  // Prompt 571, migration 0315. Moderation and discovery were two systems that
  // never spoke: suspend/delete wrote only moderation_status, and nothing here
  // read it. Absent-means-active, like every other field above.
  moderation_status?: string | null;
};

export type EligibilityStartupProfile = {
  membership_id: string;
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
      // nothing suspended before 0168 landed can silently reappear. §B's
      // always-available switch writes the same pair.
      if (org.owner_suspended_at || org.platform_suspended_at) return false;
      const profile = profileByOrg.get(org.id);
      if (profile && (profile.owner_suspended_at || profile.platform_suspended_at)) return false;
      // Prompt 07/08 visibilidade simétrica — is_test is a COHORT, not
      // censorship: a test viewer sees test + real, a real viewer sees real
      // only. Folded in here from the old excludeTestOrgIds() round-trip:
      // the caller already selects the whole org row, so this needed neither
      // a second query nor its own capability probe.
      if (!viewerIsTest && org.is_test === true) return false;
      // Prompt 563 — unconditional, unlike is_test above. A test viewer sees
      // test orgs; nobody sees an org excluded from discovery, because the
      // reason this exists is that the org must not be a listing at all. The
      // case it was built for: Sherlock Deal, the platform, carrying a startup
      // profile inside its own marketplace. Mirrors
      // matchdeal_profile_discovery_excluded() in SQL — the deck RPC and this
      // filter must never disagree about who is listable.
      if (org.discovery_excluded_reason) return false;
      // Prompt 571 — a suspended or deleted account leaves the pipeline for as
      // long as that lasts, and returns on undo with nothing to unset. Kept
      // here rather than dual-written into discovery_excluded_reason: that
      // column means "never list this", a permanent property, and making one
      // field answer two questions is what would make undo hard.
      //
      // Prompt 850 §A asked for isVisibleToOthers here instead ("use that
      // pure function — do not write a second predicate"), which would also
      // let a TIME-BOXED suspension expire on its own, exactly as
      // isLoginBlocked already does for the same account. Nuno's decision on
      // 07/09, when the two landed together: keep 571's strict form. So a
      // suspension only lifts here when a developer undoes it, even if the
      // founder's own login has already been restored by the clock. The two
      // halves of "suspended" therefore disagree by design, not by accident
      // — if that is ever revisited, isVisibleToOthers (account-moderation.ts)
      // is the one-line replacement, and moderation_suspended_until is the
      // column it needs adding back to EligibilityOrg.
      if ((org.moderation_status ?? 'active') !== 'active') return false;
      // The founder's own nine-field gate — the same one that unlocks their
      // Pipeline — reused, never reimplemented.
      return isProfileGateComplete(org);
    })
    .map((org) => org.id);
}
