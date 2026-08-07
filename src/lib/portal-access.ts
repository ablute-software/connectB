// Shared investor-portal identity/eligibility helpers — extracted from
// Prompt 58's pipeline route (prompt 59's Agenda/Today need the exact same
// "which startups can this investor see" and "who is this investor" logic,
// so this became worth sharing rather than a third copy-paste).
import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveActiveInvestorMember } from './investor-membership';
import { pipelineTestFlagAvailable } from './pipeline-test-flag-capability';

export async function resolveInvestorProfile(admin: SupabaseClient, userId: string) {
  const member = await resolveActiveInvestorMember(admin, userId);
  if (!member) return null;
  const { data: profile } = await admin.from('matchdeal_profiles').select('id, sectors, stages_invested, geographies, instruments, ticket_min, ticket_max, usual_co_investors')
    .eq('membership_id', member.id).eq('kind', 'investor').maybeSingle();
  return profile ?? null;
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
// is_test filter — see excludeTestOrgIds below, called from
// eligiblePipelineOrgIds only.
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
  return [...ids];
}

// Prompt 07/08 visibilidade simétrica — is_test is a COHORT, not censorship:
// a test-account viewer sees test + real content; a real-account viewer sees
// real only. Previously this excluded test orgs unconditionally, which made
// the platform untestable (test accounts are the only accounts that exist
// today). Deliberately NOT called from activeGrantOrgIds — see its own
// comment above for why that specific combination is a regression, not a
// fix. No-ops (returns ids unchanged) until migration 0139 is applied.
async function excludeTestOrgIds(admin: SupabaseClient, ids: string[], viewerIsTest: boolean): Promise<string[]> {
  if (ids.length === 0 || viewerIsTest || !(await pipelineTestFlagAvailable())) return ids;
  const { data: testOrgs } = await admin.from('orgs').select('id').eq('is_test', true).in('id', ids);
  const testIds = new Set((testOrgs ?? []).map((o) => o.id as string));
  return ids.filter((id) => !testIds.has(id));
}

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
// Eligibility here = published MatchDeal startup profiles, i.e. the same
// population already visible to investors in the swipe deck. Deliberately
// NOT matchdeal_eligible_deck(): that RPC carries weekly-quota/rotation
// state and a replay-reset that clears swipes once everything's been liked —
// calling it from a second surface would consume deck state meant for the
// deck itself. is_visible is the right filter (not a raw kind='startup'
// select): migration 0105 made it computed as is_complete AND not
// owner/platform-suspended, exactly "published" in the sense this prompt
// means.
export async function eligiblePipelineOrgIds(admin: SupabaseClient, viewerIsTest: boolean) {
  const { data } = await admin.from('matchdeal_profiles').select('membership_id').eq('kind', 'startup').eq('is_visible', true);
  const ids = [...new Set((data ?? []).map((p) => p.membership_id as string))];
  return excludeTestOrgIds(admin, ids, viewerIsTest);
}

// Same QA fallback as /api/portal/access — @ablute.pt sessions get into the
// shell at all via is_ablute_developer(), not a real access_grants row, so
// without this every page fed by this helper would silently show nothing
// for QA while the rest of the shell looks identical to a real investor's.
// Read-only: falls back to the QA user's own org (org_members), never
// fabricates a grant — every write route still refuses QA writes on its own.
export async function eligibleOrgIds(sb: SupabaseClient, admin: SupabaseClient, userId: string, email: string, personId: string | null) {
  const granted = await activeGrantOrgIds(admin, email, personId);
  if (granted.length > 0) return granted;
  const { data: isAbluteQa } = await sb.rpc('is_ablute_developer');
  if (!isAbluteQa) return granted;
  const { data: membership } = await admin.from('org_members').select('org_id').eq('user_id', userId).limit(1).maybeSingle();
  return membership ? [membership.org_id as string] : [];
}
