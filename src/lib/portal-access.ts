// Shared investor-portal identity/eligibility helpers — extracted from
// Prompt 58's pipeline route (prompt 59's Agenda/Today need the exact same
// "which startups can this investor see" and "who is this investor" logic,
// so this became worth sharing rather than a third copy-paste).
import type { SupabaseClient } from '@supabase/supabase-js';

export async function resolveInvestorProfile(admin: SupabaseClient, userId: string) {
  const { data: member } = await admin.from('matchdeal_investor_members').select('id')
    .eq('user_id', userId).eq('status', 'active').maybeSingle();
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
  const { data: membership } = await admin.from('matchdeal_investor_members').select('catalog_entity_id')
    .eq('user_id', userId).eq('status', 'active').maybeSingle();
  return (membership?.catalog_entity_id as string | undefined) ?? null;
}

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
