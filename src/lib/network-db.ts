import 'server-only';
// Prompt 316 — My Network 1/9. The I/O side of the feature: resolves a
// signed-in user to their network_actors row, reads/writes connections and
// invites, and gathers the wide, unfiltered rows the pure suggestion engine
// (network.ts) actually decides over. Same pure/adapter split as
// company-gaps.ts/company-knowledge-db.ts — no product rule lives here,
// only reads and writes.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NetworkActorKind, NetworkConnection, NetworkInvite, NetworkInviteContextKind, NetworkGroup, NetworkGroupKind, NetworkGroupMember } from './types';
import { canonicalPair, canCreateGroup, canAddGroupMember, type DeliveryRow, type GroupMembershipRow } from './network';
import { checkNetworkContent } from './network-content-policy';

export interface ResolvedActor {
  actorId: string;
  kind: NetworkActorKind;
  orgId?: string;
  // Prompt 317 §B — an investor's catalog_entity_id (matchdeal_investor_members'
  // own link, migration 0053), the same canonical identity a founder's
  // catalog_deliveries row points back to. This is what lets
  // readInvestedActorIdsFor resolve "which founders count THIS investor as
  // invested", the eligibility signal investor_portfolio groups need —
  // never populated for a founder actor.
  investorCatalogEntityId?: string;
}

// Mirrors matchdeal_current_membership_ids()/matchdeal_current_profile_ids()
// (migration 0053) in application code rather than calling those RPCs: both
// rely on auth.uid(), which reads as null under the service-role client this
// adapter always uses — there is no user JWT in that context, regardless of
// which userId we mean to resolve. A founder is checked first (the common
// case); an investor identity only exists once they have an active
// matchdeal_investor_members row AND a matching 'investor'-kind profile —
// see the migration's own header comment for why this is the identity used,
// and its real consequence (an investor needs a MatchDeal profile to
// participate in My Network at all).
export async function resolveActorId(admin: SupabaseClient, userId: string): Promise<ResolvedActor | null> {
  const { data: member } = await admin.from('org_members').select('org_id').eq('user_id', userId).maybeSingle();
  if (member) {
    const { data: actor } = await admin.from('network_actors').select('id').eq('org_id', member.org_id).maybeSingle();
    if (actor) return { actorId: actor.id as string, kind: 'founder', orgId: member.org_id as string };
  }

  const { data: investorMember } = await admin.from('matchdeal_investor_members')
    .select('id, catalog_entity_id').eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (investorMember) {
    const { data: profile } = await admin.from('matchdeal_profiles')
      .select('id').eq('membership_id', investorMember.id).eq('kind', 'investor').maybeSingle();
    if (profile) {
      const { data: actor } = await admin.from('network_actors').select('id').eq('matchdeal_profile_id', profile.id).maybeSingle();
      if (actor) {
        return { actorId: actor.id as string, kind: 'investor', investorCatalogEntityId: investorMember.catalog_entity_id as string };
      }
    }
  }
  return null;
}

// Prompt 321 Pedido C — 3 strikes suspends My Network access (only My
// Network, never the app itself — that's what makes network_suspended_at a
// column of its own rather than reusing orgs.platform_suspended_at, which
// suspends the whole pipeline). Checked at every WRITE surface this series
// has ever added (invites, referrals, follow-on asks, Pathfinder asks,
// posts) — never at reads, since a suspended actor can still see and
// receive, just not act.
export async function isNetworkActorSuspended(admin: SupabaseClient, actorId: string): Promise<boolean> {
  const { data } = await admin.from('network_actors').select('network_suspended_at').eq('id', actorId).maybeSingle();
  return !!data?.network_suspended_at;
}
export const NETWORK_SUSPENDED_ERROR = 'Your My Network access has been suspended following a content report.';

export interface ActorDisplay {
  actorId: string;
  kind: NetworkActorKind;
  name: string;
}

// Resolves display names for a list of actor ids — the piece RLS
// deliberately can't do from the browser (network_actors_self_read only
// lets an actor read their OWN row), so every UI surface that needs to show
// the OTHER side of a connection/invite goes through this, server-side.
export async function resolveActorDisplays(admin: SupabaseClient, actorIds: string[]): Promise<Map<string, ActorDisplay>> {
  const out = new Map<string, ActorDisplay>();
  if (actorIds.length === 0) return out;
  const { data: actors } = await admin.from('network_actors').select('id, org_id, matchdeal_profile_id').in('id', actorIds);
  const orgIds = ((actors ?? []) as { id: string; org_id: string | null; matchdeal_profile_id: string | null }[])
    .filter((a) => a.org_id).map((a) => a.org_id as string);
  const profileIds = ((actors ?? []) as { id: string; org_id: string | null; matchdeal_profile_id: string | null }[])
    .filter((a) => a.matchdeal_profile_id).map((a) => a.matchdeal_profile_id as string);

  const [{ data: orgs }, { data: profiles }] = await Promise.all([
    orgIds.length ? admin.from('orgs').select('id, name').in('id', orgIds) : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    profileIds.length
      ? admin.from('matchdeal_profiles').select('id, entity_name, representative_name').in('id', profileIds)
      : Promise.resolve({ data: [] as { id: string; entity_name: string | null; representative_name: string | null }[] }),
  ]);
  const orgNameById = new Map((orgs ?? []).map((o) => [o.id as string, o.name as string]));
  const profileNameById = new Map(
    (profiles ?? []).map((p) => [p.id as string, (p.entity_name as string | null) ?? (p.representative_name as string | null) ?? 'Investor']),
  );

  for (const a of (actors ?? []) as { id: string; org_id: string | null; matchdeal_profile_id: string | null }[]) {
    if (a.org_id) out.set(a.id, { actorId: a.id, kind: 'founder', name: orgNameById.get(a.org_id) ?? 'Startup' });
    else if (a.matchdeal_profile_id) out.set(a.id, { actorId: a.id, kind: 'investor', name: profileNameById.get(a.matchdeal_profile_id) ?? 'Investor' });
  }
  return out;
}

function mapConnection(row: Record<string, unknown>): NetworkConnection {
  return {
    id: row.id as string,
    actorLowId: row.actor_low_id as string,
    actorHighId: row.actor_high_id as string,
    status: row.status as NetworkConnection['status'],
    blockedByActorId: (row.blocked_by_actor_id as string | null) ?? null,
    originContext: (row.origin_context as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapInvite(row: Record<string, unknown>): NetworkInvite {
  return {
    id: row.id as string,
    fromActorId: row.from_actor_id as string,
    toActorId: row.to_actor_id as string,
    contextKind: row.context_kind as NetworkInviteContextKind,
    contextRef: (row.context_ref as string | null) ?? null,
    message: row.message as string,
    status: row.status as NetworkInvite['status'],
    expiresAt: row.expires_at as string,
    createdAt: row.created_at as string,
    respondedAt: (row.responded_at as string | null) ?? null,
    groupId: (row.group_id as string | null) ?? null,
  };
}

// Prompt 330 §B — "does an account already exist for this email". Reads
// through find_org_by_member_email (migration 0222), a narrow SECURITY
// DEFINER function limited to a single indexed auth.users.email lookup —
// never an unbounded listUsers() scan (the JS admin SDK has no
// getUserByEmail; see deal-messages.ts's own comment on why that scan was
// declined elsewhere). Returns null on no match — the caller's job is to
// say so honestly, never to invent a contact or send an invite anyway.
export async function findOrgByMemberEmail(admin: SupabaseClient, email: string): Promise<{ orgId: string; orgName: string } | null> {
  const { data } = await admin.rpc('find_org_by_member_email', { p_email: email.trim().toLowerCase() });
  const row = (data as { org_id: string; org_name: string }[] | null)?.[0];
  return row ? { orgId: row.org_id, orgName: row.org_name } : null;
}

// Every org gets a network_actors row automatically (trigger, migration
// 0209) the moment it's created, so this is a plain lookup, never a create.
export async function findActorIdByOrgId(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await admin.from('network_actors').select('id').eq('org_id', orgId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function readConnectionsForActor(admin: SupabaseClient, actorId: string): Promise<NetworkConnection[]> {
  const { data } = await admin.from('network_connections')
    .select('*').or(`actor_low_id.eq.${actorId},actor_high_id.eq.${actorId}`).order('created_at', { ascending: false });
  return (data ?? []).map(mapConnection);
}

export async function readInvitesForActor(admin: SupabaseClient, actorId: string): Promise<{ received: NetworkInvite[]; sent: NetworkInvite[] }> {
  const [{ data: received }, { data: sent }] = await Promise.all([
    admin.from('network_invites').select('*').eq('to_actor_id', actorId).order('created_at', { ascending: false }),
    admin.from('network_invites').select('*').eq('from_actor_id', actorId).order('created_at', { ascending: false }),
  ]);
  return { received: (received ?? []).map(mapInvite), sent: (sent ?? []).map(mapInvite) };
}

export async function countPendingInvitesFrom(admin: SupabaseClient, actorId: string): Promise<number> {
  const { count } = await admin.from('network_invites')
    .select('id', { count: 'exact', head: true }).eq('from_actor_id', actorId).eq('status', 'pending');
  return count ?? 0;
}

export async function createInvite(admin: SupabaseClient, params: {
  fromActorId: string; toActorId: string; contextKind: NetworkInviteContextKind; contextRef?: string | null; message: string; groupId?: string | null;
}): Promise<{ ok: true; invite: NetworkInvite } | { ok: false; error: string }> {
  if (await isNetworkActorSuspended(admin, params.fromActorId)) return { ok: false, error: NETWORK_SUSPENDED_ERROR };
  const contentCheck = checkNetworkContent(params.message);
  if (contentCheck.blocked) return { ok: false, error: contentCheck.reason! };

  const { data, error } = await admin.from('network_invites').insert({
    from_actor_id: params.fromActorId, to_actor_id: params.toActorId,
    context_kind: params.contextKind, context_ref: params.contextRef ?? null, message: params.message, group_id: params.groupId ?? null,
  }).select('*').single();
  if (error) {
    // The DB trigger raises this exact message on the 5-pending cap — see
    // enforce_network_invite_pending_cap, migration 0209.
    if (error.message.includes('NETWORK_INVITE_PENDING_CAP_REACHED')) {
      return { ok: false, error: 'You already have 5 pending invites out — wait for one to be answered before sending another.' };
    }
    return { ok: false, error: error.message };
  }
  return { ok: true, invite: mapInvite(data) };
}

export async function respondToInvite(
  admin: SupabaseClient, inviteId: string, respondingActorId: string, action: 'accept' | 'decline',
): Promise<{ ok: true; connection?: NetworkConnection } | { ok: false; error: string }> {
  const { data: invite } = await admin.from('network_invites').select('*').eq('id', inviteId).maybeSingle();
  if (!invite) return { ok: false, error: 'Invite not found.' };
  if (invite.to_actor_id !== respondingActorId) return { ok: false, error: 'This invite is not yours to answer.' };
  if (invite.status !== 'pending') return { ok: false, error: 'This invite was already answered or has expired.' };

  const newStatus = action === 'accept' ? 'accepted' : 'declined';
  const { error: updateError } = await admin.from('network_invites')
    .update({ status: newStatus, responded_at: new Date().toISOString() }).eq('id', inviteId).eq('status', 'pending');
  if (updateError) return { ok: false, error: updateError.message };

  if (action === 'decline') return { ok: true };

  // Prompt 317 — a group-join invite (group_id set) accepts into
  // network_group_members instead of network_connections: joining a group
  // is membership, never an implicit 1:1 connection with its owner.
  if (invite.group_id) {
    const { error: memberError } = await admin.from('network_group_members')
      .upsert(
        { group_id: invite.group_id, actor_id: invite.to_actor_id, added_by_actor_id: invite.from_actor_id, status: 'active', joined_at: new Date().toISOString() },
        { onConflict: 'group_id,actor_id' },
      );
    if (memberError) return { ok: false, error: memberError.message };
    return { ok: true };
  }

  const [actorLowId, actorHighId] = canonicalPair(invite.from_actor_id as string, invite.to_actor_id as string);
  const { data: connection, error: connectionError } = await admin.from('network_connections')
    .upsert(
      { actor_low_id: actorLowId, actor_high_id: actorHighId, status: 'active', origin_context: invite.context_ref ?? invite.message },
      { onConflict: 'actor_low_id,actor_high_id' },
    ).select('*').single();
  if (connectionError) return { ok: false, error: connectionError.message };
  return { ok: true, connection: mapConnection(connection) };
}

export async function removeConnection(admin: SupabaseClient, connectionId: string, actorId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin.from('network_connections').update({ status: 'removed', updated_at: new Date().toISOString() })
    .eq('id', connectionId).or(`actor_low_id.eq.${actorId},actor_high_id.eq.${actorId}`);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function blockConnection(admin: SupabaseClient, connectionId: string, actorId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin.from('network_connections')
    .update({ status: 'blocked', blocked_by_actor_id: actorId, updated_at: new Date().toISOString() })
    .eq('id', connectionId).or(`actor_low_id.eq.${actorId},actor_high_id.eq.${actorId}`);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// The wide, unfiltered join the pure computeSharedInvestorSuggestions
// (network.ts) decides over: every catalog-sourced delivery, its entity's
// CURRENT status, and the delivering org's opt-in flag. Deliberately reads
// wider than any one org needs (both sides of every pair) so the pure
// function — not this query's WHERE clause — is what a test can exercise
// for "no bilateral opt-in", "no invested stage".
export async function readSharedInvestorDeliveryRows(admin: SupabaseClient): Promise<DeliveryRow[]> {
  const { data } = await admin.from('catalog_deliveries')
    .select('org_id, catalog_id, entity_id, catalog_entities(name), entities(status), orgs(network_discoverable)')
    .not('entity_id', 'is', null);
  return ((data ?? []) as unknown as {
    org_id: string; catalog_id: string;
    catalog_entities: { name: string } | null;
    entities: { status: string } | null;
    orgs: { network_discoverable: boolean } | null;
  }[])
    .filter((r) => r.entities && r.orgs)
    .map((r) => ({
      orgId: r.org_id,
      catalogId: r.catalog_id,
      investorName: r.catalog_entities?.name ?? 'Unknown investor',
      entityStatus: r.entities!.status,
      orgDiscoverable: r.orgs!.network_discoverable,
    }));
}

// ---------------------------------------------------------------------------
// Prompt 317 — groups.
export async function readActiveConnectionActorIds(admin: SupabaseClient, actorId: string): Promise<string[]> {
  const connections = await readConnectionsForActor(admin, actorId);
  return connections.filter((c) => c.status === 'active').map((c) => (c.actorLowId === actorId ? c.actorHighId : c.actorLowId));
}

// The investor_portfolio eligibility signal: which founder actors have THIS
// investor (by their stable catalog_entity_id -- matchdeal_investor_members'
// own link) marked as status='invested' in their pipeline. Same
// catalog_deliveries join 316 already uses for the shared-investor
// suggestion, read from the investor's own side this time.
export async function readInvestedActorIdsForInvestor(admin: SupabaseClient, investorCatalogEntityId: string): Promise<string[]> {
  const { data } = await admin.from('catalog_deliveries')
    .select('org_id, entity_id, entities(status)')
    .eq('catalog_id', investorCatalogEntityId).not('entity_id', 'is', null);
  const investedOrgIds = ((data ?? []) as unknown as { org_id: string; entities: { status: string } | null }[])
    .filter((r) => r.entities?.status === 'invested')
    .map((r) => r.org_id);
  if (investedOrgIds.length === 0) return [];
  const { data: actors } = await admin.from('network_actors').select('id, org_id').in('org_id', investedOrgIds);
  return (actors ?? []).map((a) => a.id as string);
}

function mapGroup(row: Record<string, unknown>): NetworkGroup {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    kind: row.kind as NetworkGroupKind,
    ownerActorId: row.owner_actor_id as string,
    createdAt: row.created_at as string,
  };
}

function mapGroupMember(row: Record<string, unknown>): NetworkGroupMember {
  return {
    id: row.id as string,
    groupId: row.group_id as string,
    actorId: row.actor_id as string,
    addedByActorId: row.added_by_actor_id as string,
    status: row.status as NetworkGroupMember['status'],
    joinedAt: (row.joined_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

// Every group the actor either owns or is an active member of. RLS would
// already scope this correctly for a direct client select, but this route
// goes through the service-role admin client (consistent with the rest of
// this adapter), so the WHERE clause here is what actually does the
// scoping.
export async function readGroupsForActor(admin: SupabaseClient, actorId: string): Promise<{ group: NetworkGroup; memberCount: number }[]> {
  const { data: memberships } = await admin.from('network_group_members').select('group_id').eq('actor_id', actorId).eq('status', 'active');
  const { data: owned } = await admin.from('network_groups').select('id').eq('owner_actor_id', actorId);
  const groupIds = [...new Set([...(memberships ?? []).map((m) => m.group_id as string), ...(owned ?? []).map((o) => o.id as string)])];
  if (groupIds.length === 0) return [];
  const [{ data: groups }, { data: counts }] = await Promise.all([
    admin.from('network_groups').select('*').in('id', groupIds),
    admin.from('network_group_members').select('group_id').in('group_id', groupIds).eq('status', 'active'),
  ]);
  const countByGroup = new Map<string, number>();
  for (const c of counts ?? []) countByGroup.set(c.group_id as string, (countByGroup.get(c.group_id as string) ?? 0) + 1);
  return (groups ?? []).map((g) => ({ group: mapGroup(g), memberCount: countByGroup.get(g.id as string) ?? 0 }));
}

export interface GroupMemberView { actorId: string; status: NetworkGroupMember['status']; joinedAt: string | null }

export async function readGroupDetail(admin: SupabaseClient, groupId: string, actorId: string): Promise<{
  group: NetworkGroup; members: GroupMemberView[]; isOwner: boolean; isActiveMember: boolean;
} | null> {
  const { data: groupRow } = await admin.from('network_groups').select('*').eq('id', groupId).maybeSingle();
  if (!groupRow) return null;
  const group = mapGroup(groupRow);
  const { data: memberRows } = await admin.from('network_group_members').select('*').eq('group_id', groupId).neq('status', 'left');
  const members = (memberRows ?? []).map(mapGroupMember);
  const isOwner = group.ownerActorId === actorId;
  const isActiveMember = isOwner || members.some((m) => m.actorId === actorId && m.status === 'active');
  if (!isOwner && !isActiveMember) return null;
  return { group, members: members.map((m) => ({ actorId: m.actorId, status: m.status, joinedAt: m.joinedAt ?? null })), isOwner, isActiveMember };
}

// Creation validates eligibility for EVERY initial member with the exact
// same canAddGroupMember rule an addition-after-creation uses (network.ts) --
// one rule, two call sites, per the prompt's own "a mesma regra aplica-se
// nos dois momentos". The owner becomes an 'active' member immediately
// (no invite needed for oneself); everyone else gets a real invite through
// the existing network_invites machine, so creating a group with many
// members can hit the sender's own 5-pending cap -- a deliberate,
// anti-spam-consistent consequence of reusing one state machine rather
// than a silent bulk-add.
export async function createGroup(admin: SupabaseClient, params: {
  ownerActorId: string; ownerIsInvestor: boolean; name: string; description?: string | null; kind: NetworkGroupKind; initialMemberActorIds: string[];
}): Promise<{ ok: true; group: NetworkGroup; invited: number } | { ok: false; error: string }> {
  if (!canCreateGroup(params.kind, params.ownerIsInvestor)) {
    return { ok: false, error: 'Only an investor actor can create an investor_portfolio group.' };
  }

  const activeConnectionActorIds = await readActiveConnectionActorIds(admin, params.ownerActorId);
  const investedActorIdsForOwner = params.kind === 'investor_portfolio'
    ? await readInvestedActorIdsForOwnerInvestor(admin, params.ownerActorId)
    : [];

  const ineligible = params.initialMemberActorIds.filter((candidateActorId) => !canAddGroupMember({
    groupKind: params.kind, ownerIsInvestor: params.ownerIsInvestor, activeConnectionActorIds, investedActorIdsForOwner, candidateActorId,
  }));
  if (ineligible.length > 0) {
    return { ok: false, error: params.kind === 'investor_portfolio' ? "One of these startups isn't marked invested by you yet." : 'You can only add existing connections.' };
  }

  const { data: groupRow, error: groupError } = await admin.from('network_groups')
    .insert({ owner_actor_id: params.ownerActorId, name: params.name, description: params.description ?? null, kind: params.kind })
    .select('*').single();
  if (groupError || !groupRow) return { ok: false, error: groupError?.message ?? 'Could not create the group.' };
  const group = mapGroup(groupRow);

  await admin.from('network_group_members').insert({
    group_id: group.id, actor_id: params.ownerActorId, added_by_actor_id: params.ownerActorId, status: 'active', joined_at: new Date().toISOString(),
  });

  let invited = 0;
  for (const candidateActorId of params.initialMemberActorIds) {
    const result = await createInvite(admin, {
      fromActorId: params.ownerActorId, toActorId: candidateActorId, contextKind: 'shared_group',
      contextRef: group.name, message: `Join ${group.name}`, groupId: group.id,
    });
    if (result.ok) invited++;
  }
  return { ok: true, group, invited };
}

// Exported for network-referrals-db.ts (Prompt 318): the identical "which
// founder actors does THIS investor actor count as invested" resolution
// investor_portfolio groups already needed.
export async function readInvestedActorIdsForOwnerInvestor(admin: SupabaseClient, ownerActorId: string): Promise<string[]> {
  const catalogEntityId = await resolveInvestorCatalogEntityIdForActor(admin, ownerActorId);
  if (!catalogEntityId) return [];
  return readInvestedActorIdsForInvestor(admin, catalogEntityId);
}

// Prompt 319 — the same actor -> catalog_entity_id chain, exported directly
// for callers (the referral route's follow-on badge propagation) that need
// the identity itself, not the derived invested-startups list.
export async function resolveInvestorCatalogEntityIdForActor(admin: SupabaseClient, actorId: string): Promise<string | null> {
  const { data: actor } = await admin.from('network_actors').select('matchdeal_profile_id').eq('id', actorId).maybeSingle();
  if (!actor?.matchdeal_profile_id) return null;
  const { data: profile } = await admin.from('matchdeal_profiles').select('membership_id').eq('id', actor.matchdeal_profile_id).maybeSingle();
  if (!profile) return null;
  const { data: member } = await admin.from('matchdeal_investor_members').select('catalog_entity_id').eq('id', profile.membership_id).maybeSingle();
  return (member?.catalog_entity_id as string | undefined) ?? null;
}

export async function addGroupMember(admin: SupabaseClient, params: {
  groupId: string; ownerActorId: string; ownerIsInvestor: boolean; candidateActorId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: groupRow } = await admin.from('network_groups').select('*').eq('id', params.groupId).maybeSingle();
  if (!groupRow) return { ok: false, error: 'Group not found.' };
  const group = mapGroup(groupRow);
  if (group.ownerActorId !== params.ownerActorId) return { ok: false, error: 'Only the group owner can add members.' };

  const activeConnectionActorIds = await readActiveConnectionActorIds(admin, params.ownerActorId);
  const investedActorIdsForOwner = group.kind === 'investor_portfolio' ? await readInvestedActorIdsForOwnerInvestor(admin, params.ownerActorId) : [];
  const eligible = canAddGroupMember({
    groupKind: group.kind, ownerIsInvestor: params.ownerIsInvestor, activeConnectionActorIds, investedActorIdsForOwner,
    candidateActorId: params.candidateActorId,
  });
  if (!eligible) return { ok: false, error: group.kind === 'investor_portfolio' ? "This startup isn't marked invested by you." : 'You can only add an existing connection.' };

  const result = await createInvite(admin, {
    fromActorId: params.ownerActorId, toActorId: params.candidateActorId, contextKind: 'shared_group',
    contextRef: group.name, message: `Join ${group.name}`, groupId: group.id,
  });
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

export async function renameGroup(admin: SupabaseClient, groupId: string, ownerActorId: string, name: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await admin.from('network_groups').update({ name }).eq('id', groupId).eq('owner_actor_id', ownerActorId).select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'Only the group owner can rename it.' };
  return { ok: true };
}

export async function removeGroupMember(admin: SupabaseClient, groupId: string, ownerActorId: string, targetActorId: string): Promise<{ ok: boolean; error?: string }> {
  const { data: group } = await admin.from('network_groups').select('owner_actor_id').eq('id', groupId).maybeSingle();
  if (!group || group.owner_actor_id !== ownerActorId) return { ok: false, error: 'Only the group owner can remove a member.' };
  const { error } = await admin.from('network_group_members').update({ status: 'left' }).eq('group_id', groupId).eq('actor_id', targetActorId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// Any member can leave, any time, "sem drama e sem notificar ninguém" --
// no confirmation round-trip beyond the UI's own, no email, no signal to
// the rest of the group.
export async function leaveGroup(admin: SupabaseClient, groupId: string, actorId: string): Promise<{ ok: boolean; error?: string }> {
  const { error } = await admin.from('network_group_members').update({ status: 'left' }).eq('group_id', groupId).eq('actor_id', actorId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// The wide, unfiltered read the pure computeSharedGroupSuggestions
// (network.ts) decides over -- every ACTIVE membership row across every
// group, never scoped to one group in this query itself.
export async function readActiveGroupMembershipRows(admin: SupabaseClient): Promise<GroupMembershipRow[]> {
  const { data } = await admin.from('network_group_members')
    .select('group_id, actor_id, network_groups(name)').eq('status', 'active');
  return ((data ?? []) as unknown as { group_id: string; actor_id: string; network_groups: { name: string } | null }[])
    .map((r) => ({ groupId: r.group_id, actorId: r.actor_id, groupName: r.network_groups?.name ?? 'Unknown group' }));
}
