import 'server-only';
// Prompt 320 — My Network 5/9. Pathfinder reads: which of my active
// connections has a verified invested relationship with the investor I'm
// looking at. Reuses 316/318's own catalog_deliveries/connections adapters
// (readActiveConnectionActorIds, readInvestedActorIdsForInvestor) — never a
// second query for "who invested in whom".
import type { SupabaseClient } from '@supabase/supabase-js';
import { computePathfinderMatches, isLiveReferralState, type PathfinderMatch, type NetworkReferralState } from './network';
import { readActiveConnectionActorIds, readInvestedActorIdsForInvestor, resolveActorDisplays, isNetworkActorSuspended, NETWORK_SUSPENDED_ERROR } from './network-db';

// Same entityId -> investorCatalogEntityId lookup as 319's follow-on widget
// (catalog_deliveries.entity_id), plus the investor's own network_actors id
// (needed both to check for an existing referral targeting them, and as the
// referral composer's targetActorId once an ask leads there).
export async function resolveInvestorForEntity(admin: SupabaseClient, orgId: string, entityId: string): Promise<{ investorCatalogEntityId: string; investorActorId: string; investorName: string } | null> {
  const { data: delivery } = await admin.from('catalog_deliveries').select('catalog_id').eq('org_id', orgId).eq('entity_id', entityId).maybeSingle();
  if (!delivery) return null;
  const catalogId = delivery.catalog_id as string;

  const { data: members } = await admin.from('matchdeal_investor_members').select('id').eq('catalog_entity_id', catalogId);
  const memberIds = (members ?? []).map((m) => m.id as string);
  if (memberIds.length === 0) return null;
  const { data: profiles } = await admin.from('matchdeal_profiles').select('id').eq('kind', 'investor').in('membership_id', memberIds);
  const profileIds = (profiles ?? []).map((p) => p.id as string);
  if (profileIds.length === 0) return null;
  const { data: actor } = await admin.from('network_actors').select('id').in('matchdeal_profile_id', profileIds).maybeSingle();
  if (!actor) return null;

  const { data: catalogEntity } = await admin.from('catalog_entities').select('name').eq('id', catalogId).maybeSingle();
  return { investorCatalogEntityId: catalogId, investorActorId: actor.id as string, investorName: catalogEntity?.name ?? 'this investor' };
}

export interface PathfinderMatchView extends PathfinderMatch { name: string }

export async function getPathfinderMatches(admin: SupabaseClient, params: {
  myActorId: string; myOrgId: string; investorCatalogEntityId: string; investorActorId: string;
}): Promise<PathfinderMatchView[]> {
  const [connectionActorIds, investedActorIds] = await Promise.all([
    readActiveConnectionActorIds(admin, params.myActorId),
    readInvestedActorIdsForInvestor(admin, params.investorCatalogEntityId),
  ]);
  const candidateIds = connectionActorIds.filter((id) => investedActorIds.includes(id));
  if (candidateIds.length === 0) return [];

  // Pedido C — same network_discoverable opt-in guard 316's own suggestions
  // respect: a candidate's ORG must have opted in, or they never surface
  // here, regardless of the underlying relationship being real.
  const { data: candidateActors } = await admin.from('network_actors').select('id, org_id').in('id', candidateIds);
  const orgIdByActorId = new Map((candidateActors ?? []).map((a) => [a.id as string, a.org_id as string | null]));
  const orgIds = [...new Set([...orgIdByActorId.values()].filter((id): id is string => !!id))];
  const { data: orgs } = orgIds.length ? await admin.from('orgs').select('id, network_discoverable').in('id', orgIds) : { data: [] as { id: string; network_discoverable: boolean | null }[] };
  const discoverableByOrgId = new Map((orgs ?? []).map((o) => [o.id as string, !!o.network_discoverable]));

  const { data: liveReferrals } = await admin.from('network_referrals')
    .select('referrer_actor_id, state').eq('referred_org_id', params.myOrgId).eq('target_actor_id', params.investorActorId).in('referrer_actor_id', candidateIds);
  const referrerHasLiveReferral = new Set((liveReferrals ?? []).filter((r) => isLiveReferralState(r.state as NetworkReferralState)).map((r) => r.referrer_actor_id as string));

  const rows = candidateIds.map((actorId) => ({
    actorId,
    isDiscoverable: discoverableByOrgId.get(orgIdByActorId.get(actorId) ?? '') ?? false,
    hasInvestedRelationshipWithTarget: true, // candidateIds is already the intersection with investedActorIds
    hasLiveReferralForThisAsk: referrerHasLiveReferral.has(actorId),
  }));
  const matches = computePathfinderMatches(rows);
  const displays = await resolveActorDisplays(admin, matches.map((m) => m.actorId));
  return matches.map((m) => ({ ...m, name: displays.get(m.actorId)?.name ?? 'A connection' }));
}

// Pedido B, Pipeline row indicator — one batched query for the WHOLE
// pipeline table (never per-row), same "fetch once, filter client-side"
// shape as /api/founder/competitor-investments. Returns just the set of
// entity ids that have at least one Pathfinder match, never names or
// counts — the table row only needs a dot to exist, the actual names live
// behind the click-through to PathfinderCard.
export async function getPathfinderEntityIdsWithMatch(admin: SupabaseClient, params: { myActorId: string; myOrgId: string }): Promise<Set<string>> {
  const { data: myDeliveries } = await admin.from('catalog_deliveries').select('catalog_id, entity_id').eq('org_id', params.myOrgId).not('entity_id', 'is', null);
  const myRows = (myDeliveries ?? []) as { catalog_id: string; entity_id: string }[];
  if (myRows.length === 0) return new Set();

  const connectionActorIds = await readActiveConnectionActorIds(admin, params.myActorId);
  if (connectionActorIds.length === 0) return new Set();

  const { data: connectionActors } = await admin.from('network_actors').select('id, org_id').in('id', connectionActorIds);
  const connectionOrgIds = ((connectionActors ?? []) as { id: string; org_id: string | null }[]).filter((a) => a.org_id).map((a) => a.org_id as string);
  if (connectionOrgIds.length === 0) return new Set();

  const { data: orgs } = await admin.from('orgs').select('id, network_discoverable').in('id', connectionOrgIds);
  const discoverableOrgIds = new Set(((orgs ?? []) as { id: string; network_discoverable: boolean | null }[]).filter((o) => o.network_discoverable).map((o) => o.id as string));
  if (discoverableOrgIds.size === 0) return new Set();

  const { data: theirDeliveries } = await admin.from('catalog_deliveries')
    .select('catalog_id, org_id, entities(status)').in('org_id', [...discoverableOrgIds]).not('entity_id', 'is', null);
  const theirInvestedCatalogIds = new Set(
    ((theirDeliveries ?? []) as unknown as { catalog_id: string; entities: { status: string } | null }[])
      .filter((r) => r.entities?.status === 'invested').map((r) => r.catalog_id),
  );

  return new Set(myRows.filter((r) => theirInvestedCatalogIds.has(r.catalog_id)).map((r) => r.entity_id));
}

// Pedido B — "ask {connection} for an intro" notifies the connection to
// compose the referral themselves; it never creates the referral on their
// behalf (keeps authorship with whoever is actually vouching).
export async function createPathfinderAsk(admin: SupabaseClient, params: { requesterActorId: string; connectionActorId: string; targetActorId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await isNetworkActorSuspended(admin, params.requesterActorId)) return { ok: false, error: NETWORK_SUSPENDED_ERROR };
  const { error } = await admin.from('network_pathfinder_asks').insert({
    requester_actor_id: params.requesterActorId, connection_actor_id: params.connectionActorId, target_actor_id: params.targetActorId,
  });
  if (error && error.code !== '23505') return { ok: false, error: error.message };
  return { ok: true };
}

export interface PathfinderAskForConnection { id: string; requesterOrgId: string; requesterName: string; targetActorId: string; targetName: string; requestedAt: string }

export async function getOpenPathfinderAsksForConnection(admin: SupabaseClient, connectionActorId: string): Promise<PathfinderAskForConnection[]> {
  const { data } = await admin.from('network_pathfinder_asks')
    .select('id, requester_actor_id, target_actor_id, requested_at').eq('connection_actor_id', connectionActorId).is('resolved_at', null)
    .order('requested_at', { ascending: false });
  const rows = data ?? [];
  if (rows.length === 0) return [];

  const actorIds = [...new Set([...rows.map((r) => r.requester_actor_id as string), ...rows.map((r) => r.target_actor_id as string)])];
  const [displays, actorOrgRows] = await Promise.all([
    resolveActorDisplays(admin, actorIds),
    admin.from('network_actors').select('id, org_id').in('id', rows.map((r) => r.requester_actor_id as string)),
  ]);
  const orgIdByActorId = new Map((actorOrgRows.data ?? []).map((a) => [a.id as string, a.org_id as string | null]));

  return rows.map((r) => ({
    id: r.id as string,
    requesterOrgId: orgIdByActorId.get(r.requester_actor_id as string) ?? '',
    requesterName: displays.get(r.requester_actor_id as string)?.name ?? 'A connection',
    targetActorId: r.target_actor_id as string,
    targetName: displays.get(r.target_actor_id as string)?.name ?? 'an investor',
    requestedAt: r.requested_at as string,
  })).filter((a) => a.requesterOrgId);
}

export async function dismissPathfinderAsk(admin: SupabaseClient, params: { id: string; connectionActorId: string }): Promise<void> {
  await admin.from('network_pathfinder_asks').update({ resolved_at: new Date().toISOString() })
    .eq('id', params.id).eq('connection_actor_id', params.connectionActorId).is('resolved_at', null);
}
