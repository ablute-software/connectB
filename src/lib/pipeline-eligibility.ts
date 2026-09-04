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
//   * isVisibleToOthers(moderation_status, moderation_suspended_until) —
//     the back-office suspend/delete state. See the block below.
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
// THE HOLE THIS PROMPT CLOSES, and it is the reason the is_visible
// requirement could not simply be deleted: filterEligibleOrgs never read
// orgs.moderation_status, and isVisibleToOthers (account-moderation.ts,
// written for exactly this) was called by NOTHING in production. Live
// proof: Estojo was suspended from the back-office on 02/09 10:27 UTC
// (quarantine to 02/10, moderation_status = 'suspended', its founder cannot
// even log in) and was still admitted into a brand-new investor's discovery
// pipeline on 04/09 at 09:03. Dropping is_visible without adding this would
// have handed suspended accounts back to investors — the same class of bug
// 556 §A was written to close. 'active' passes; 'suspended' passes only
// once its optional time-box has expired (a 24h suspension from the
// Suspicious Accounts queue restores itself, exactly as isLoginBlocked
// already does); 'deleted' never passes. That pure predicate is reused
// as-is — a second copy of "what suspended means" is how these two states
// drift apart.
//
// Pure on purpose: no Supabase client, no capability probe, no `import
// 'server-only'` — the caller does the two reads, this decides. Every rule
// below is unit-tested in pipeline-eligibility.test.ts.
import { isProfileGateComplete, type ProfileGateOrg } from './pipeline-unlock';
import { isVisibleToOthers, type ModerationStatus } from './account-moderation';

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
  // Migration 0121 (status) + 0180 (the time-boxed clock). Same
  // absent-means-active degrade as every other optional column here: an
  // environment without them has no moderation state to honour.
  moderation_status?: ModerationStatus | null;
  moderation_suspended_until?: string | null;
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
  nowIso: string = new Date().toISOString(),
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
      // Prompt 850 §A — the back-office state, previously unread here.
      if (!isVisibleToOthers(org.moderation_status ?? 'active', org.moderation_suspended_until ?? null, nowIso)) return false;
      // Prompt 07/08 visibilidade simétrica — is_test is a COHORT, not
      // censorship: a test viewer sees test + real, a real viewer sees real
      // only. Folded in here from the old excludeTestOrgIds() round-trip:
      // the caller already selects the whole org row, so this needed neither
      // a second query nor its own capability probe.
      if (!viewerIsTest && org.is_test === true) return false;
      // The founder's own nine-field gate — the same one that unlocks their
      // Pipeline — reused, never reimplemented.
      return isProfileGateComplete(org);
    })
    .map((org) => org.id);
}
