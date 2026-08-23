import 'server-only';
// Prompt 316 — My Network 1/9. The I/O side of the feature: resolves a
// signed-in user to their network_actors row, reads/writes connections and
// invites, and gathers the wide, unfiltered rows the pure suggestion engine
// (network.ts) actually decides over. Same pure/adapter split as
// company-gaps.ts/company-knowledge-db.ts — no product rule lives here,
// only reads and writes.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NetworkActorKind, NetworkConnection, NetworkInvite, NetworkInviteContextKind } from './types';
import { canonicalPair, type DeliveryRow } from './network';

export interface ResolvedActor {
  actorId: string;
  kind: NetworkActorKind;
  orgId?: string;
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
    .select('id').eq('user_id', userId).eq('status', 'active').maybeSingle();
  if (investorMember) {
    const { data: profile } = await admin.from('matchdeal_profiles')
      .select('id').eq('membership_id', investorMember.id).eq('kind', 'investor').maybeSingle();
    if (profile) {
      const { data: actor } = await admin.from('network_actors').select('id').eq('matchdeal_profile_id', profile.id).maybeSingle();
      if (actor) return { actorId: actor.id as string, kind: 'investor' };
    }
  }
  return null;
}

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
  };
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
  fromActorId: string; toActorId: string; contextKind: NetworkInviteContextKind; contextRef?: string | null; message: string;
}): Promise<{ ok: true; invite: NetworkInvite } | { ok: false; error: string }> {
  const { data, error } = await admin.from('network_invites').insert({
    from_actor_id: params.fromActorId, to_actor_id: params.toActorId,
    context_kind: params.contextKind, context_ref: params.contextRef ?? null, message: params.message,
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
