import 'server-only';
// Prompt 319 — My Network 4/9. Follow-on signal reads/writes on top of
// catalog_deliveries' new followon_* columns (migration 0213), plus the
// startup's "ask" requests. Pure rules (eligibility, expiry, payload
// shaping) all live in network.ts — this file only resolves data and calls
// into them, same split as network-referrals-db.ts.
import type { SupabaseClient } from '@supabase/supabase-js';
import { canSignalFollowOn, isFollowOnActive, shapeFollowOnPayload, FOLLOWON_VALIDITY_MONTHS, type FollowOnVisibility, type FollowOnPayload } from './network';
import { NETWORK_SUSPENDED_ERROR } from './network-db';

// Prompt 321 Pedido C — same network_suspended_at check every other write
// surface in this series applies, resolved from the investor's own
// catalog_entity_id (this file's own identity key) rather than requiring
// every caller to separately resolve a network_actors id first.
async function isInvestorNetworkSuspended(admin: SupabaseClient, investorCatalogEntityId: string): Promise<boolean> {
  const { data: member } = await admin.from('matchdeal_investor_members').select('id').eq('catalog_entity_id', investorCatalogEntityId).maybeSingle();
  if (!member) return false;
  const { data: profile } = await admin.from('matchdeal_profiles').select('id').eq('membership_id', member.id).eq('kind', 'investor').maybeSingle();
  if (!profile) return false;
  const { data: actor } = await admin.from('network_actors').select('network_suspended_at').eq('matchdeal_profile_id', profile.id).maybeSingle();
  return !!actor?.network_suspended_at;
}

interface DeliveryFollowOnRow {
  id: string; org_id: string; catalog_id: string;
  followon_visibility: FollowOnVisibility | null; followon_signaled_at: string | null;
  followon_expires_at: string | null; followon_revoked_at: string | null;
}

// Prompt 396 §1 — exported so the GET /api/network/followon?entityId=X
// route can gate `eligible` on the SAME invested check the POST already
// enforces, instead of a looser catalog_deliveries-exists lookup that let
// the "Ask about follow-on interest" button render (as dead weight — the
// POST silently rejected it) for any MatchDeal-delivered investor,
// invested or not.
export async function findInvestedDelivery(admin: SupabaseClient, orgId: string, investorCatalogEntityId: string): Promise<{ delivery: DeliveryFollowOnRow; invested: boolean } | null> {
  const { data } = await admin.from('catalog_deliveries')
    .select('id, org_id, catalog_id, entity_id, followon_visibility, followon_signaled_at, followon_expires_at, followon_revoked_at, entities(status)')
    .eq('org_id', orgId).eq('catalog_id', investorCatalogEntityId).maybeSingle();
  if (!data) return null;
  const invested = (data as unknown as { entities: { status: string } | null }).entities?.status === 'invested';
  return { delivery: data as unknown as DeliveryFollowOnRow, invested };
}

export async function setFollowOnSignal(admin: SupabaseClient, params: {
  orgId: string; investorCatalogEntityId: string; visibility: FollowOnVisibility;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (await isInvestorNetworkSuspended(admin, params.investorCatalogEntityId)) return { ok: false, error: NETWORK_SUSPENDED_ERROR };
  const found = await findInvestedDelivery(admin, params.orgId, params.investorCatalogEntityId);
  if (!found || !canSignalFollowOn(found.invested)) {
    return { ok: false, error: 'You can only signal follow-on interest for a startup you have a verified invested relationship with.' };
  }
  const now = new Date();
  const expiresAt = new Date(now); expiresAt.setUTCMonth(expiresAt.getUTCMonth() + FOLLOWON_VALIDITY_MONTHS);
  const { error } = await admin.from('catalog_deliveries').update({
    followon_visibility: params.visibility, followon_signaled_at: now.toISOString(),
    followon_expires_at: expiresAt.toISOString(), followon_revoked_at: null,
  }).eq('id', found.delivery.id);
  if (error) return { ok: false, error: error.message };

  await admin.from('network_followon_requests')
    .update({ resolved_at: now.toISOString() })
    .eq('org_id', params.orgId).eq('investor_catalog_entity_id', params.investorCatalogEntityId).is('resolved_at', null);
  return { ok: true };
}

// Visibility is changeable independently of the 6-month clock (Pedido A: "a
// escolha do investidor no momento de marcar, alterável depois") — never
// resets signaled_at/expires_at.
export async function updateFollowOnVisibility(admin: SupabaseClient, params: {
  orgId: string; investorCatalogEntityId: string; visibility: FollowOnVisibility;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const found = await findInvestedDelivery(admin, params.orgId, params.investorCatalogEntityId);
  if (!found || !isFollowOnActive({ expiresAt: found.delivery.followon_expires_at, revokedAt: found.delivery.followon_revoked_at }, new Date())) {
    return { ok: false, error: 'No active follow-on signal to update.' };
  }
  const { error } = await admin.from('catalog_deliveries').update({ followon_visibility: params.visibility }).eq('id', found.delivery.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function revokeFollowOnSignal(admin: SupabaseClient, params: { orgId: string; investorCatalogEntityId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const found = await findInvestedDelivery(admin, params.orgId, params.investorCatalogEntityId);
  if (!found) return { ok: false, error: 'No relationship found.' };
  const { error } = await admin.from('catalog_deliveries').update({ followon_revoked_at: new Date().toISOString() }).eq('id', found.delivery.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface FollowOnStatusForFounder {
  investorCatalogEntityId: string; investorName: string; active: boolean;
  visibility: FollowOnVisibility | null; signaledAt: string | null; expiresAt: string | null;
}

// Pedido C.3 — the founder's OWN view of signals they've received: always
// the real identity + visibility label, never masked (visibility only
// controls what OTHER investors see, not what the founder themselves can
// see about their own relationship).
export async function getFollowOnStatusForOrg(admin: SupabaseClient, orgId: string): Promise<FollowOnStatusForFounder[]> {
  const { data } = await admin.from('catalog_deliveries')
    .select('catalog_id, followon_visibility, followon_signaled_at, followon_expires_at, followon_revoked_at, catalog_entities(name)')
    .eq('org_id', orgId).not('followon_signaled_at', 'is', null);
  const now = new Date();
  return ((data ?? []) as unknown as { catalog_id: string; followon_visibility: FollowOnVisibility | null; followon_signaled_at: string | null; followon_expires_at: string | null; followon_revoked_at: string | null; catalog_entities: { name: string } | null }[])
    .map((r) => ({
      investorCatalogEntityId: r.catalog_id, investorName: r.catalog_entities?.name ?? 'An investor',
      active: isFollowOnActive({ expiresAt: r.followon_expires_at, revokedAt: r.followon_revoked_at }, now),
      visibility: r.followon_visibility, signaledAt: r.followon_signaled_at, expiresAt: r.followon_expires_at,
    }));
}

// Pedido C.1 — the investor-facing dossier projection: masked per
// shapeFollowOnPayload, active signals only, identity stripped server-side
// for an 'anonymous' one before this ever reaches a response object.
export async function getFollowOnPayloadsForOrgInvestorFacing(admin: SupabaseClient, orgId: string): Promise<FollowOnPayload[]> {
  const all = await getFollowOnStatusForOrg(admin, orgId);
  return all.filter((s) => s.active).map((s) => shapeFollowOnPayload(true, s.visibility, s.investorName));
}

// For referral-badge propagation (Pedido C.2) — raw active (investor, org)
// pairs, no masking here; the caller (network-referrals-db.ts /
// investor-pipeline.ts) decides whether the VIEWER is entitled to see the
// name via the same shapeFollowOnPayload logic.
export async function getActiveFollowOnPairs(admin: SupabaseClient, orgIds: string[]): Promise<{ investorCatalogEntityId: string; orgId: string; visibility: FollowOnVisibility; investorName: string }[]> {
  if (orgIds.length === 0) return [];
  const { data } = await admin.from('catalog_deliveries')
    .select('org_id, catalog_id, followon_visibility, followon_expires_at, followon_revoked_at, catalog_entities(name)')
    .in('org_id', orgIds).not('followon_signaled_at', 'is', null);
  const now = new Date();
  return ((data ?? []) as unknown as { org_id: string; catalog_id: string; followon_visibility: FollowOnVisibility | null; followon_expires_at: string | null; followon_revoked_at: string | null; catalog_entities: { name: string } | null }[])
    .filter((r) => isFollowOnActive({ expiresAt: r.followon_expires_at, revokedAt: r.followon_revoked_at }, now))
    .map((r) => ({ investorCatalogEntityId: r.catalog_id, orgId: r.org_id, visibility: r.followon_visibility as FollowOnVisibility, investorName: r.catalog_entities?.name ?? 'An investor' }));
}

// Pedido C.4 — the startup ASKS, the investor decides. A duplicate open ask
// for the same pair is a harmless no-op (migration 0213's partial unique
// index), never a second row piling up.
export async function requestFollowOnAsk(admin: SupabaseClient, params: { orgId: string; investorCatalogEntityId: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: myActor } = await admin.from('network_actors').select('network_suspended_at').eq('org_id', params.orgId).maybeSingle();
  if (myActor?.network_suspended_at) return { ok: false, error: NETWORK_SUSPENDED_ERROR };
  const found = await findInvestedDelivery(admin, params.orgId, params.investorCatalogEntityId);
  if (!found || !found.invested) return { ok: false, error: 'You can only ask an investor with a verified invested relationship.' };
  const { error } = await admin.from('network_followon_requests').insert({ org_id: params.orgId, investor_catalog_entity_id: params.investorCatalogEntityId });
  if (error && error.code !== '23505') return { ok: false, error: error.message };
  return { ok: true };
}

export interface FollowOnRequestForInvestor { orgId: string; orgName: string; requestedAt: string }

export async function getOpenFollowOnRequestsForInvestor(admin: SupabaseClient, investorCatalogEntityId: string): Promise<FollowOnRequestForInvestor[]> {
  const { data } = await admin.from('network_followon_requests')
    .select('org_id, requested_at, orgs(name)').eq('investor_catalog_entity_id', investorCatalogEntityId).is('resolved_at', null)
    .order('requested_at', { ascending: false });
  return ((data ?? []) as unknown as { org_id: string; requested_at: string; orgs: { name: string } | null }[])
    .map((r) => ({ orgId: r.org_id, orgName: r.orgs?.name ?? 'A startup', requestedAt: r.requested_at }));
}

export async function dismissFollowOnRequest(admin: SupabaseClient, params: { orgId: string; investorCatalogEntityId: string }): Promise<void> {
  await admin.from('network_followon_requests').update({ resolved_at: new Date().toISOString() })
    .eq('org_id', params.orgId).eq('investor_catalog_entity_id', params.investorCatalogEntityId).is('resolved_at', null);
}

// Prompt 340 §A.3 — expiresAt added so Dashboard can show "active follow-on,
// with expirations" without a second query shape; network/page.tsx doesn't
// read it today but isn't broken by gaining it.
export interface InvestedRelationshipForInvestor { orgId: string; orgName: string; investorCatalogEntityId: string; hasActiveSignal: boolean; visibility: FollowOnVisibility | null; expiresAt: string | null }

// The investor's own management view: every startup they hold a verified
// 'invested' relationship with (across all orgs, not just ones asking),
// so they can proactively signal without waiting for a request.
export async function getInvestedRelationshipsForInvestor(admin: SupabaseClient, investorCatalogEntityId: string): Promise<InvestedRelationshipForInvestor[]> {
  const { data } = await admin.from('catalog_deliveries')
    .select('org_id, followon_visibility, followon_expires_at, followon_revoked_at, entities(status), orgs(name)')
    .eq('catalog_id', investorCatalogEntityId).not('entity_id', 'is', null);
  const now = new Date();
  return ((data ?? []) as unknown as { org_id: string; followon_visibility: FollowOnVisibility | null; followon_expires_at: string | null; followon_revoked_at: string | null; entities: { status: string } | null; orgs: { name: string } | null }[])
    .filter((r) => r.entities?.status === 'invested')
    .map((r) => ({
      orgId: r.org_id, orgName: r.orgs?.name ?? 'A startup', investorCatalogEntityId,
      hasActiveSignal: isFollowOnActive({ expiresAt: r.followon_expires_at, revokedAt: r.followon_revoked_at }, now),
      visibility: r.followon_visibility, expiresAt: r.followon_expires_at,
    }));
}
