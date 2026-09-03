// Shared investor-portal identity/eligibility helpers — extracted from
// Prompt 58's pipeline route (prompt 59's Agenda/Today need the exact same
// "which startups can this investor see" and "who is this investor" logic,
// so this became worth sharing rather than a third copy-paste).
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveActiveInvestorMember } from './investor-membership';
import { pipelineTestFlagAvailable } from './pipeline-test-flag-capability';
import { closedOrgIds } from './org-closed';
import { filterEligibleOrgs, type EligibilityOrg, type EligibilityStartupProfile } from './pipeline-eligibility';
import { MATCHDEAL_TIER_TO_INVESTOR_PLAN, type InvestorPlanTier } from './plans';

export async function resolveInvestorProfile(admin: SupabaseClient, userId: string) {
  const member = await resolveActiveInvestorMember(admin, userId);
  if (!member) return null;
  // exclusions_sectors/exclusions_notes entram aqui porque os três sítios que
  // constroem uma InvestorThesis (today/route.ts, investor-pipeline.ts,
  // investor-archive.ts) passam todos por esta função — Prompt 200 §C.
  const { data: profile } = await admin.from('matchdeal_profiles').select('id, sectors, stages_invested, geographies, instruments, ticket_min, ticket_max, usual_co_investors, exclusions_sectors, exclusions_notes')
    .eq('membership_id', member.id).eq('kind', 'investor').maybeSingle();
  return profile ?? null;
}

// Prompt 402 — matchdeal_profiles.plan_tier (kind='investor') stores
// MatchDeal's own internal tier names, mapped to the priced InvestorPlanTier
// via plans.ts's MATCHDEAL_TIER_TO_INVESTOR_PLAN. Split in two so a caller
// that already resolved its own investorProfile (investor-pipeline.ts's
// monthlyCap lookup, Prompt 153) doesn't pay for a second
// resolveInvestorProfile round-trip; a caller that only has a userId (the
// startup dossier route's Hype badge gate, Prompt 402) uses the wrapper.
// 'tier_a' mirrors investor-pipeline.ts's own DEFAULT_MATCHDEAL_TIER —
// same fallback, single mapping, so the two call sites can't diverge.
export async function resolveInvestorPlanTierForProfile(admin: SupabaseClient, investorProfileId: string): Promise<InvestorPlanTier> {
  const { data: row } = await admin.from('matchdeal_profiles').select('plan_tier').eq('id', investorProfileId).maybeSingle();
  return MATCHDEAL_TIER_TO_INVESTOR_PLAN[(row?.plan_tier as string) ?? 'tier_a'] ?? 'pro_scout';
}

export async function resolveInvestorPlanTier(admin: SupabaseClient, userId: string): Promise<InvestorPlanTier> {
  const profile = await resolveInvestorProfile(admin, userId);
  return profile ? resolveInvestorPlanTierForProfile(admin, profile.id as string) : 'pro_scout';
}

// AP-14 — the stable per-organization investor identity (same convention
// admin_org_actions.org_ref_id and matchdeal_pairings already use), as
// distinct from matchdeal_investor_members.id which is per TEAM MEMBER.
// Needed anywhere a Pipeline decision must be read/written at the org
// level so every teammate sees the same status.
export async function resolveInvestorCatalogEntityId(admin: SupabaseClient, userId: string) {
  const member = await resolveActiveInvestorMember(admin, userId);
  return member?.catalog_entity_id ?? null;
}

// Item #15 correction (mini_prompt_URGENTE_regressao_778f1bf_activegrantorgids
// _20260806) — activeGrantOrgIds() must NEVER filter by is_test. A grant is
// a deliberate human act (a founder, or the backoffice on their behalf,
// choosing to let this specific person in); is_test is for discovery and
// aggregate stats, never for authorization. This was tried in 778f1bf and
// reverted: 100% of the platform's access_grants rows point at the SAME org
// (ablute_ — the backoffice's investor-access-request approval route grants
// against a fixed ABLUTE_ORG_ID for every approval), so marking that one org
// is_test made this function return [] for literally every investor on the
// platform, real or not — Data Room, Today, Agenda, diligence checklist, all
// blank. is_ablute_developer() doesn't rescue it either: it only recognizes
// @ablute.pt sessions, not the gmail-style accounts QA/testers actually use.
// eligiblePipelineOrgIds (discovery) and computeTrackingCountsByStage
// (aggregate stats) are the correct, and only correct, places for the
// is_test filter — filterEligibleOrgs (pipeline-eligibility.ts) is where
// that now lives, applied to discovery only.
//
// Prompt 556 — one exclusion is added, and it is not the is_test one: a
// CLOSED org (orgs.closed_at, migration 0303) drops out. close_org() already
// revokes every active grant, so this is a belt over a brace — but a grant
// row written by any other path after the org closed would otherwise put a
// dead startup back into a live data room. Deliberate consequence, and the
// right one per Prompt 556 §C: on Access granted the row DISAPPEARS rather
// than becoming an "unavailable" note. What keeps a closed startup visible
// to an investor is HISTORY (a recorded decision), not access.
export async function activeGrantOrgIds(admin: SupabaseClient, email: string, personId: string | null) {
  const orParts = [`grantee_email.eq.${email}`, `invited_email.eq.${email}`];
  if (personId) orParts.push(`person_id.eq.${personId}`);
  const { data: grants } = await admin.from('access_grants').select('org_id, confirmed_at, invited_email, revoked_at, expires_at')
    .is('revoked_at', null).or(orParts.join(','));
  const now = new Date();
  const ids = new Set<string>();
  for (const g of grants ?? []) {
    const notExpired = !g.expires_at || new Date(g.expires_at as string) > now;
    const confirmedIfInvited = !g.invited_email || g.confirmed_at;
    if (notExpired && confirmedIfInvited) ids.add(g.org_id as string);
  }
  const closed = await closedOrgIds(admin, [...ids]);
  return [...ids].filter((id) => !closed.has(id));
}

// Prompt 07/08 visibilidade simétrica — is_test is a COHORT, not censorship:
// a test-account viewer sees test + real content; a real-account viewer sees
// real only. Prompt 556 folded the old excludeTestOrgIds() helper that
// enforced this into filterEligibleOrgs (pipeline-eligibility.ts): it was
// called from eligiblePipelineOrgIds and nowhere else, and that function
// already selects the whole org row, so the rule cost a second query and its
// own capability probe for a field it was holding in memory anyway. The rule
// itself is unchanged, and it is still deliberately NOT applied to
// activeGrantOrgIds — see its own comment above for why that specific
// combination is a regression, not a fix.

// Resolves whether the CALLER (not the target) is a test-cohort viewer, from
// their investor catalog_entities.is_test — the same identity
// resolveInvestorCatalogEntityId already gives every caller here. Unresolved
// (no linked investor entity) defaults to false — closed by default, per the
// visibilidade simétrica spec.
export async function resolveViewerIsTest(admin: SupabaseClient, catalogEntityId: string | null): Promise<boolean> {
  if (!catalogEntityId || !(await pipelineTestFlagAvailable())) return false;
  const { data } = await admin.from('catalog_entities').select('is_test').eq('id', catalogEntityId).maybeSingle();
  return !!(data as { is_test?: boolean } | null)?.is_test;
}

// Prompt 120 Block A — Pipeline eligibility, deliberately separate from
// activeGrantOrgIds/eligibleOrgIds above (those stay exactly as they are for
// every other portal route, which is about DILIGENCE access to documents).
// Discovery must not be gated behind a grant the founder hasn't decided to
// give yet — that inverted the funnel (the root cause the prompt names).
//
// Prompt 556 — this comment now says what the code does, which for two
// prompts it did not: Prompt 120's header claimed "published MatchDeal
// startup profiles only" while the code under it (Prompt 184) asked
// isProfileGateComplete, the FOUNDER's own CRM unlock. Eligibility is once
// again the founder's explicit act of publishing — a startup
// matchdeal_profiles row with is_visible = true — plus three exclusions: a
// closed org (orgs.closed_at, migration 0303), a suspended one (both
// sources), and a test org for a non-test viewer. filterEligibleOrgs holds
// every one of those rules, pure and unit-tested; the full reasoning for
// the reversal, including why Caramel Biscuit's old symptom is now the
// intended behaviour, is in pipeline-eligibility.ts's own header.
//
// No capability probe on the read side: `select('*')` simply omits
// closed_at/is_test/owner_suspended_at on a pre-migration environment, and
// filterEligibleOrgs treats every one of them as absent-means-no. It never
// errors on a column that doesn't exist yet.
export async function eligiblePipelineOrgIds(admin: SupabaseClient, viewerIsTest: boolean) {
  const { data: orgs } = await admin.from('orgs').select('*');
  const orgRows = (orgs ?? []) as EligibilityOrg[];
  if (orgRows.length === 0) return [];

  const { data: mdProfiles } = await admin.from('matchdeal_profiles')
    .select('membership_id, is_visible, owner_suspended_at, platform_suspended_at')
    .eq('kind', 'startup').in('membership_id', orgRows.map((o) => o.id));

  return filterEligibleOrgs(orgRows, (mdProfiles ?? []) as EligibilityStartupProfile[], viewerIsTest);
}

// Same QA fallback as /api/portal/access — @ablute.pt sessions get into the
// shell at all via is_ablute_developer(), not a real access_grants row, so
// without this every page fed by this helper would silently show nothing
// for QA while the rest of the shell looks identical to a real investor's.
// Read-only: falls back to the QA user's own org (org_members), never
// fabricates a grant — every write route still refuses QA writes on its own.
// Prompt 336 — the @ablute.pt "no real grant, fall back to your own org's
// documents" bypass is gone: those accounts (and nunomarujo@gmail.com) are
// real investors now and go through the same activeGrantOrgIds path as
// anyone else. `sb`/`userId` stay as params so every call site doesn't need
// updating, but neither is read here anymore.
export async function eligibleOrgIds(sb: SupabaseClient, admin: SupabaseClient, userId: string, email: string, personId: string | null) {
  return activeGrantOrgIds(admin, email, personId);
}
