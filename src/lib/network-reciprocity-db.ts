import 'server-only';
// Prompt 323 — My Network 8/9. Office hours + reverse scout: reads/writes
// only, reusing 316's connection resolution, 321's anti-sales linter, and
// 318's referral machinery (a scout-originated referral IS a network_referrals
// row, just with originating_scout_request_id set and a different
// eligibility path — never a parallel referral concept).
import type { SupabaseClient } from '@supabase/supabase-js';
import { checkNetworkContent } from './network-content-policy';
import { isOfferActive, canReferViaScoutRequest, isDuplicateReferral, type NetworkOfferKind, type NetworkReferralState } from './network';
import { isNetworkActorSuspended, NETWORK_SUSPENDED_ERROR, readActiveConnectionActorIds, resolveActorDisplays } from './network-db';

export interface NetworkOffer {
  id: string; actorId: string; actorName: string; kind: NetworkOfferKind; description: string;
  slotsTotal: number; slotsClaimed: number; expiresAt: string; createdAt: string;
}

export async function createOffer(admin: SupabaseClient, params: {
  actorId: string; kind: NetworkOfferKind; description: string; slotsTotal: number; expiresAt: string;
}): Promise<{ ok: true; offerId: string } | { ok: false; error: string }> {
  if (await isNetworkActorSuspended(admin, params.actorId)) return { ok: false, error: NETWORK_SUSPENDED_ERROR };
  const contentCheck = checkNetworkContent(params.description);
  if (contentCheck.blocked) return { ok: false, error: contentCheck.reason! };
  if (!params.description.trim()) return { ok: false, error: 'Description is required.' };
  if (params.slotsTotal < 1 || params.slotsTotal > 20) return { ok: false, error: 'Slots must be between 1 and 20.' };
  if (new Date(params.expiresAt).getTime() <= Date.now()) return { ok: false, error: 'Expiry must be in the future.' };

  const { data, error } = await admin.from('network_offers').insert({
    actor_id: params.actorId, kind: params.kind, description: params.description.trim(),
    slots_total: params.slotsTotal, expires_at: params.expiresAt,
  }).select('id').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not create offer.' };
  return { ok: true, offerId: data.id as string };
}

// The atomic claim itself is entirely inside network_claim_offer_slot
// (migration 0217, row-locked) — this just calls it and translates the
// short status string into a clear, user-facing error. Never a
// read-then-write from here either.
export async function claimOfferSlot(admin: SupabaseClient, params: { offerId: string; claimantActorId: string; note?: string | null }): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await isNetworkActorSuspended(admin, params.claimantActorId)) return { ok: false, error: NETWORK_SUSPENDED_ERROR };
  const { data, error } = await admin.rpc('network_claim_offer_slot', {
    p_offer_id: params.offerId, p_claimant_actor_id: params.claimantActorId, p_note: params.note ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const status = data as string;
  if (status === 'ok') return { ok: true };
  const messages: Record<string, string> = {
    not_found: 'This offer no longer exists.', expired: 'This offer has expired.',
    already_claimed: "You've already claimed a slot on this offer.", full: 'All slots on this offer have been claimed.',
  };
  return { ok: false, error: messages[status] ?? 'Could not claim a slot.' };
}

export async function readOffersForActor(admin: SupabaseClient, actorId: string): Promise<NetworkOffer[]> {
  const connectionActorIds = await readActiveConnectionActorIds(admin, actorId);
  const visibleActorIds = [...new Set([actorId, ...connectionActorIds])];
  const { data } = await admin.from('network_offers')
    .select('id, actor_id, kind, description, slots_total, slots_claimed, expires_at, created_at')
    .in('actor_id', visibleActorIds).order('created_at', { ascending: false });
  const rows = (data ?? []) as { id: string; actor_id: string; kind: NetworkOfferKind; description: string; slots_total: number; slots_claimed: number; expires_at: string; created_at: string }[];
  const now = new Date();
  // Pedido A — an offer disappears from the feed on expiry OR exhaustion,
  // for EVERYONE including its own author (they still see it via "My
  // offers" bookkeeping elsewhere if ever needed — out of this prompt's
  // scope; here it's simply gone, same as the prompt describes).
  const active = rows.filter((r) => isOfferActive({ slotsTotal: r.slots_total, slotsClaimed: r.slots_claimed, expiresAt: r.expires_at }, now));
  const displays = await resolveActorDisplays(admin, [...new Set(active.map((r) => r.actor_id))]);
  return active.map((r) => ({
    id: r.id, actorId: r.actor_id, actorName: displays.get(r.actor_id)?.name ?? 'Someone in your network',
    kind: r.kind, description: r.description, slotsTotal: r.slots_total, slotsClaimed: r.slots_claimed,
    expiresAt: r.expires_at, createdAt: r.created_at,
  }));
}

export interface NetworkScoutRequest {
  id: string; investorActorId: string; investorName: string; sectors: string[]; stage: string | null;
  geography: string | null; description: string; status: 'open' | 'closed'; expiresAt: string; createdAt: string;
}

export async function createScoutRequest(admin: SupabaseClient, params: {
  investorActorId: string; sectors: string[]; stage?: string | null; geography?: string | null; description: string; expiresAt: string;
}): Promise<{ ok: true; requestId: string } | { ok: false; error: string }> {
  if (await isNetworkActorSuspended(admin, params.investorActorId)) return { ok: false, error: NETWORK_SUSPENDED_ERROR };
  const contentCheck = checkNetworkContent(params.description);
  if (contentCheck.blocked) return { ok: false, error: contentCheck.reason! };
  if (!params.description.trim()) return { ok: false, error: 'Description is required.' };
  if (new Date(params.expiresAt).getTime() <= Date.now()) return { ok: false, error: 'Expiry must be in the future.' };

  const { data, error } = await admin.from('network_scout_requests').insert({
    investor_actor_id: params.investorActorId, sectors: params.sectors, stage: params.stage ?? null,
    geography: params.geography ?? null, description: params.description.trim(), expires_at: params.expiresAt,
  }).select('id').single();
  if (error || !data) return { ok: false, error: error?.message ?? 'Could not create scout request.' };
  return { ok: true, requestId: data.id as string };
}

export async function closeScoutRequest(admin: SupabaseClient, params: { requestId: string; investorActorId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: reqRow } = await admin.from('network_scout_requests').select('investor_actor_id').eq('id', params.requestId).maybeSingle();
  if (!reqRow) return { ok: false, error: 'Request not found.' };
  if (reqRow.investor_actor_id !== params.investorActorId) return { ok: false, error: 'You can only close your own requests.' };
  const { error } = await admin.from('network_scout_requests').update({ status: 'closed' }).eq('id', params.requestId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function readScoutRequestsForActor(admin: SupabaseClient, actorId: string): Promise<NetworkScoutRequest[]> {
  const connectionActorIds = await readActiveConnectionActorIds(admin, actorId);
  const visibleActorIds = [...new Set([actorId, ...connectionActorIds])];
  const { data } = await admin.from('network_scout_requests')
    .select('id, investor_actor_id, sectors, stage, geography, description, status, expires_at, created_at')
    .in('investor_actor_id', visibleActorIds).eq('status', 'open').order('created_at', { ascending: false });
  const rows = (data ?? []) as { id: string; investor_actor_id: string; sectors: string[]; stage: string | null; geography: string | null; description: string; status: 'open' | 'closed'; expires_at: string; created_at: string }[];
  const now = Date.now();
  const active = rows.filter((r) => new Date(r.expires_at).getTime() > now);
  const displays = await resolveActorDisplays(admin, [...new Set(active.map((r) => r.investor_actor_id))]);
  return active.map((r) => ({
    id: r.id, investorActorId: r.investor_actor_id, investorName: displays.get(r.investor_actor_id)?.name ?? 'An investor',
    sectors: r.sectors, stage: r.stage, geography: r.geography, description: r.description,
    status: r.status, expiresAt: r.expires_at, createdAt: r.created_at,
  }));
}

// Pedido B's referral entry point. Eligibility here is DELIBERATELY
// different from 318's canCreateReferral (network.ts's own
// canReferViaScoutRequest, documented as an explicit exception): no
// invested-relationship requirement, because the investor's own open
// request already is the implicit invitation. The referred startup must
// still be the founder's own active connection — never invented.
export async function createReferralViaScoutRequest(admin: SupabaseClient, params: {
  scoutRequestId: string; referrerActorId: string; referredActorId: string; message: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await isNetworkActorSuspended(admin, params.referrerActorId)) return { ok: false, error: NETWORK_SUSPENDED_ERROR };
  const contentCheck = checkNetworkContent(params.message);
  if (contentCheck.blocked) return { ok: false, error: contentCheck.reason! };
  if (params.referredActorId === params.referrerActorId) return { ok: false, error: "You can't refer yourself." };

  const { data: scoutRequest } = await admin.from('network_scout_requests').select('investor_actor_id, status, expires_at').eq('id', params.scoutRequestId).maybeSingle();
  if (!scoutRequest) return { ok: false, error: 'Scout request not found.' };
  if (scoutRequest.status !== 'open' || new Date(scoutRequest.expires_at).getTime() <= Date.now()) {
    return { ok: false, error: 'This scout request is no longer open.' };
  }

  const { data: referredActor } = await admin.from('network_actors').select('org_id').eq('id', params.referredActorId).maybeSingle();
  if (!referredActor?.org_id) return { ok: false, error: 'Referred startup not found.' };

  const connectionActorIds = await readActiveConnectionActorIds(admin, params.referrerActorId);
  const eligible = canReferViaScoutRequest(connectionActorIds.includes(params.referredActorId));
  if (!eligible) return { ok: false, error: 'You can only refer one of your own active connections.' };

  const referredOrgId = referredActor.org_id as string;
  const { data: existing } = await admin.from('network_referrals')
    .select('state').eq('referred_org_id', referredOrgId).eq('target_actor_id', scoutRequest.investor_actor_id);
  if (isDuplicateReferral(((existing ?? []) as { state: NetworkReferralState }[]).map((r) => r.state))) {
    return { ok: false, error: 'A referral for this startup and target already exists and hasn\'t been resolved yet.' };
  }

  const { error } = await admin.from('network_referrals').insert({
    referrer_actor_id: params.referrerActorId, referred_org_id: referredOrgId, target_actor_id: scoutRequest.investor_actor_id,
    message: params.message.trim(), originating_scout_request_id: params.scoutRequestId,
  });
  if (error) {
    if (error.code === '23505') return { ok: false, error: 'A referral for this startup and target already exists and hasn\'t been resolved yet.' };
    return { ok: false, error: error.message };
  }
  return { ok: true };
}

// Pedido B's own "N referrals received through this request" count — read
// by the investor about their OWN request, never comparable to another
// investor's request in the same response.
export async function countReferralsForScoutRequest(admin: SupabaseClient, scoutRequestId: string): Promise<number> {
  const { count } = await admin.from('network_referrals').select('id', { count: 'exact', head: true }).eq('originating_scout_request_id', scoutRequestId);
  return count ?? 0;
}

export async function readReciprocityCounts(admin: SupabaseClient, actorId: string): Promise<{ officeHoursOffered: number; startupsReferredViaScout: number }> {
  const [{ count: offersCount }, { count: scoutReferralsCount }] = await Promise.all([
    admin.from('network_offers').select('id', { count: 'exact', head: true }).eq('actor_id', actorId),
    admin.from('network_referrals').select('id', { count: 'exact', head: true }).eq('referrer_actor_id', actorId).not('originating_scout_request_id', 'is', null),
  ]);
  return { officeHoursOffered: offersCount ?? 0, startupsReferredViaScout: scoutReferralsCount ?? 0 };
}
