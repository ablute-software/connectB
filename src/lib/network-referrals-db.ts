import 'server-only';
// Prompt 318 — My Network 3/9. Referrals: the double-opt-in state machine,
// eligibility resolution (reusing 316/317's own catalog_deliveries/
// connections adapters, never a second heuristic), and the accepted-side
// effects (Pedido C) — admitting the target investor into the referred
// org's own Vault pipeline, quota-exempt, mirroring
// matchdeal_record_interest_notification's exact entity-creation shape
// (migration 0171) since that's this codebase's only existing precedent for
// "an investor appears in a founder's pipeline organically, without the
// founder spending a pack unlock".
import type { SupabaseClient } from '@supabase/supabase-js';
import type { NetworkReferral, NetworkReferralState } from './types';
import { canCreateReferral, isDuplicateReferral, canSendReferral, MAX_REFERRALS_PER_MONTH, referralsVisibleToTarget } from './network';
import { readActiveConnectionActorIds, readInvestedActorIdsForOwnerInvestor, resolveActorDisplays } from './network-db';

export interface ReferralCandidate { actorId: string; orgId: string | null; name: string; kind: 'founder' | 'investor' }

// Composer eligibility (Pedido B's "who can I refer, and to whom"), read-only
// — never a second copy of canCreateReferral's own rule, just resolving the
// two lists that rule checks membership against, so the UI can offer only
// valid picks instead of letting the user hit createReferral's rejection.
export async function resolveReferralEligibility(admin: SupabaseClient, actorId: string, actorKind: 'founder' | 'investor'): Promise<{
  referredCandidates: ReferralCandidate[]; targetCandidates: ReferralCandidate[];
}> {
  if (actorKind === 'founder') {
    const [connectionIds, investorActorIds] = await Promise.all([
      readActiveConnectionActorIds(admin, actorId),
      readInvestorActorIdsWhoInvestedInActor(admin, actorId),
    ]);
    const displays = await resolveActorDisplays(admin, [...new Set([...connectionIds, ...investorActorIds])]);
    return {
      referredCandidates: await withOrgIds(admin, connectionIds.filter((id) => displays.get(id)?.kind === 'founder'), displays),
      targetCandidates: investorActorIds.map((id) => ({ actorId: id, orgId: null, name: displays.get(id)?.name ?? 'Investor', kind: 'investor' as const })),
    };
  }
  const [investedActorIds, connectionIds] = await Promise.all([
    readInvestedActorIdsForOwnerInvestor(admin, actorId),
    readActiveConnectionActorIds(admin, actorId),
  ]);
  const displays = await resolveActorDisplays(admin, [...new Set([...investedActorIds, ...connectionIds])]);
  return {
    referredCandidates: await withOrgIds(admin, investedActorIds, displays),
    targetCandidates: connectionIds.filter((id) => displays.get(id)?.kind === 'investor')
      .map((id) => ({ actorId: id, orgId: null, name: displays.get(id)?.name ?? 'Investor', kind: 'investor' as const })),
  };
}

async function withOrgIds(admin: SupabaseClient, actorIds: string[], displays: Map<string, { name: string; kind: 'founder' | 'investor' }>): Promise<ReferralCandidate[]> {
  if (actorIds.length === 0) return [];
  const { data } = await admin.from('network_actors').select('id, org_id').in('id', actorIds);
  const orgIdByActorId = new Map((data ?? []).map((a) => [a.id as string, a.org_id as string | null]));
  return actorIds
    .map((id) => ({ actorId: id, orgId: orgIdByActorId.get(id) ?? null, name: displays.get(id)?.name ?? 'Startup', kind: 'founder' as const }))
    .filter((c) => c.orgId != null);
}

// The reverse of readInvestedActorIdsForOwnerInvestor: given a FOUNDER's own
// actor, which investor actors have marked the founder's own org as
// status='invested' in THEIR pipeline. Same catalog_deliveries/
// catalog_entity_id chain as 316/317, walked from the org side this time.
async function readInvestorActorIdsWhoInvestedInActor(admin: SupabaseClient, founderActorId: string): Promise<string[]> {
  const { data: actorRow } = await admin.from('network_actors').select('org_id').eq('id', founderActorId).maybeSingle();
  const orgId = actorRow?.org_id as string | undefined;
  if (!orgId) return [];

  const { data: deliveries } = await admin.from('catalog_deliveries').select('catalog_id, entities(status)').eq('org_id', orgId).not('entity_id', 'is', null);
  const investedCatalogIds = ((deliveries ?? []) as unknown as { catalog_id: string; entities: { status: string } | null }[])
    .filter((d) => d.entities?.status === 'invested').map((d) => d.catalog_id);
  if (investedCatalogIds.length === 0) return [];

  const { data: members } = await admin.from('matchdeal_investor_members').select('id').in('catalog_entity_id', investedCatalogIds);
  const memberIds = (members ?? []).map((m) => m.id as string);
  if (memberIds.length === 0) return [];

  const { data: profiles } = await admin.from('matchdeal_profiles').select('id').eq('kind', 'investor').in('membership_id', memberIds);
  const profileIds = (profiles ?? []).map((p) => p.id as string);
  if (profileIds.length === 0) return [];

  const { data: actors } = await admin.from('network_actors').select('id').in('matchdeal_profile_id', profileIds);
  return (actors ?? []).map((a) => a.id as string);
}

function mapReferral(row: Record<string, unknown>): NetworkReferral {
  return {
    id: row.id as string,
    referrerActorId: row.referrer_actor_id as string,
    referredOrgId: row.referred_org_id as string,
    targetActorId: row.target_actor_id as string,
    message: row.message as string,
    state: row.state as NetworkReferralState,
    createdAt: row.created_at as string,
    referredDecidedAt: (row.referred_decided_at as string | null) ?? null,
    targetDecidedAt: (row.target_decided_at as string | null) ?? null,
  };
}

async function resolveActorIdForOrg(admin: SupabaseClient, orgId: string): Promise<string | null> {
  const { data } = await admin.from('network_actors').select('id').eq('org_id', orgId).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export async function createReferral(admin: SupabaseClient, params: {
  referrerActorId: string; referrerIsInvestor: boolean; referredOrgId: string; targetActorId: string; targetIsInvestor: boolean; message: string;
}): Promise<{ ok: true; referral: NetworkReferral } | { ok: false; error: string }> {
  const referredActorId = await resolveActorIdForOrg(admin, params.referredOrgId);
  if (!referredActorId) return { ok: false, error: 'Referred startup not found.' };
  if (referredActorId === params.referrerActorId) return { ok: false, error: 'You can\'t refer yourself.' };
  if (referredActorId === params.targetActorId) return { ok: false, error: 'The startup and the target can\'t be the same actor.' };

  // Eligibility (network.ts's canCreateReferral): the invested-relationship
  // anchor and the active-connection check are on OPPOSITE sides depending
  // on who's referring — a founder referrer needs the TARGET to be their
  // verified investor and the REFERRED startup to be their own connection;
  // an investor referrer needs the REFERRED startup to be their own
  // verified portfolio company and the TARGET to be their own connection.
  const referrerConnections = await readActiveConnectionActorIds(admin, params.referrerActorId);
  let eligible: boolean;
  if (!params.referrerIsInvestor) {
    if (!params.targetIsInvestor) return { ok: false, error: 'The target of a referral must be an investor.' };
    const investedByTarget = await readInvestedActorIdsForOwnerInvestor(admin, params.targetActorId);
    eligible = canCreateReferral({
      referrerHasInvestedRelationship: investedByTarget.includes(params.referrerActorId),
      otherPartyIsActiveConnection: referrerConnections.includes(referredActorId),
    });
  } else {
    const investedByReferrer = await readInvestedActorIdsForOwnerInvestor(admin, params.referrerActorId);
    eligible = canCreateReferral({
      referrerHasInvestedRelationship: investedByReferrer.includes(referredActorId),
      otherPartyIsActiveConnection: referrerConnections.includes(params.targetActorId),
    });
  }
  if (!eligible) {
    return {
      ok: false,
      error: params.referrerIsInvestor
        ? 'You can only refer a startup you\'ve verified as invested, to a target in your own connections.'
        : 'You can only refer one of your own connections, to an investor you\'ve verified as invested in you.',
    };
  }

  const { data: existing } = await admin.from('network_referrals')
    .select('state').eq('referred_org_id', params.referredOrgId).eq('target_actor_id', params.targetActorId);
  if (isDuplicateReferral(((existing ?? []) as { state: NetworkReferralState }[]).map((r) => r.state))) {
    return { ok: false, error: 'A referral for this startup and target already exists and hasn\'t been resolved yet.' };
  }

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const { count } = await admin.from('network_referrals')
    .select('id', { count: 'exact', head: true }).eq('referrer_actor_id', params.referrerActorId).gte('created_at', monthStart.toISOString());
  if (!canSendReferral(count ?? 0)) {
    return { ok: false, error: `You've sent ${MAX_REFERRALS_PER_MONTH} referrals this month already — the limit resets next month.` };
  }

  const { data, error } = await admin.from('network_referrals').insert({
    referrer_actor_id: params.referrerActorId, referred_org_id: params.referredOrgId, target_actor_id: params.targetActorId, message: params.message,
  }).select('*').single();
  if (error) {
    if (error.message.includes('NETWORK_REFERRAL_MONTHLY_CAP_REACHED')) {
      return { ok: false, error: `You've sent ${MAX_REFERRALS_PER_MONTH} referrals this month already — the limit resets next month.` };
    }
    if (error.code === '23505') return { ok: false, error: 'A referral for this startup and target already exists and hasn\'t been resolved yet.' };
    return { ok: false, error: error.message };
  }
  return { ok: true, referral: mapReferral(data) };
}

export async function readReferralsInvolvingActor(admin: SupabaseClient, actorId: string, referredOrgId: string | null): Promise<NetworkReferral[]> {
  const orClauses = [`referrer_actor_id.eq.${actorId}`, `target_actor_id.eq.${actorId}`];
  const { data } = await admin.from('network_referrals').select('*').or(orClauses.join(',')).order('created_at', { ascending: false });
  const rows = (data ?? []).map(mapReferral);
  // referredOrgId (the founder's own org, when acting as B) is a separate
  // axis from actorId — a founder's OWN actor is never referrer nor target
  // in the "founder A refers B" flow's own middle row, so it needs its own
  // query rather than folding into the OR above.
  if (!referredOrgId) return rows;
  const { data: asReferred } = await admin.from('network_referrals').select('*').eq('referred_org_id', referredOrgId).order('created_at', { ascending: false });
  const merged = new Map(rows.map((r) => [r.id, r]));
  for (const row of (asReferred ?? []).map(mapReferral)) merged.set(row.id, row);
  return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function respondAsReferred(admin: SupabaseClient, referralId: string, referredOrgId: string, action: 'accept' | 'decline'): Promise<{ ok: boolean; error?: string }> {
  const { data: referral } = await admin.from('network_referrals').select('*').eq('id', referralId).maybeSingle();
  if (!referral) return { ok: false, error: 'Referral not found.' };
  if (referral.referred_org_id !== referredOrgId) return { ok: false, error: 'This referral is not about your company.' };
  if (referral.state !== 'pending_referred_consent') return { ok: false, error: 'This referral was already decided or has expired.' };

  const newState = action === 'accept' ? 'pending_target_decision' : 'declined_by_referred';
  const { error } = await admin.from('network_referrals')
    .update({ state: newState, referred_decided_at: new Date().toISOString() }).eq('id', referralId).eq('state', 'pending_referred_consent');
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function respondAsTarget(admin: SupabaseClient, referralId: string, targetActorId: string, action: 'accept' | 'decline'): Promise<{ ok: boolean; error?: string }> {
  const { data: referral } = await admin.from('network_referrals').select('*').eq('id', referralId).maybeSingle();
  if (!referral) return { ok: false, error: 'Referral not found.' };
  if (referral.target_actor_id !== targetActorId) return { ok: false, error: 'This referral is not addressed to you.' };
  if (referral.state !== 'pending_target_decision') return { ok: false, error: 'This referral was already decided or has expired.' };

  const newState = action === 'accept' ? 'accepted' : 'declined_by_target';
  const { error } = await admin.from('network_referrals')
    .update({ state: newState, target_decided_at: new Date().toISOString() }).eq('id', referralId).eq('state', 'pending_target_decision');
  if (error) return { ok: false, error: error.message };

  if (action === 'accept') {
    // Pedido C, side 2: "B enters X's pipeline" needs no write at all — see
    // investor-pipeline.ts's viaReferral, which reads network_referrals
    // directly (this row, now state='accepted', is itself the record).
    // Side 1, below, DOES need a write: the investor's own entities row in
    // B's Vault pipeline, quota-exempt, same as an organic investor-interest
    // notification.
    await admitInvestorIntoReferredOrgPipeline(admin, referral.referred_org_id as string, targetActorId);
  }
  return { ok: true };
}

// Mirrors matchdeal_record_interest_notification's entity-creation shape
// (migration 0171) field-for-field — this codebase's only existing
// precedent for "an investor appears in a founder's Vault pipeline without
// the founder spending a catalog_quota unlock". quota_exempt: true is what
// actually does the exemption (catalog_deliveries_enforce_quota's own
// trigger, same migration, skips the count entirely for an exempt row).
// source: 'investor_invite' — a value the entities_source_check constraint
// has allowed since migration 0122 but no code path had adopted yet; it
// fits a referral acceptance better than 'match_deal' (no MatchDeal
// involvement here) or 'manual' (the founder never chose this).
async function admitInvestorIntoReferredOrgPipeline(admin: SupabaseClient, referredOrgId: string, targetActorId: string): Promise<void> {
  const { data: targetActor } = await admin.from('network_actors').select('matchdeal_profile_id').eq('id', targetActorId).maybeSingle();
  if (!targetActor?.matchdeal_profile_id) return;
  const { data: profile } = await admin.from('matchdeal_profiles').select('membership_id').eq('id', targetActor.matchdeal_profile_id).maybeSingle();
  if (!profile) return;
  const { data: member } = await admin.from('matchdeal_investor_members').select('catalog_entity_id').eq('id', profile.membership_id).maybeSingle();
  const catalogEntityId = member?.catalog_entity_id as string | undefined;
  if (!catalogEntityId) return;

  const { data: existingDelivery } = await admin.from('catalog_deliveries')
    .select('id').eq('org_id', referredOrgId).eq('catalog_id', catalogEntityId).maybeSingle();
  if (existingDelivery) return; // already in B's pipeline (however that happened) — never re-deliver.

  const { data: catalogEntity } = await admin.from('catalog_entities').select('*').eq('id', catalogEntityId).maybeSingle();
  if (!catalogEntity) return;

  const emailDomain = catalogEntity.email ? (String(catalogEntity.email).split('@')[1]?.toLowerCase() ?? null) : null;
  const hasEvidence = !!(catalogEntity.website || emailDomain || catalogEntity.phone || catalogEntity.address);

  const { data: newEntity, error: entityError } = await admin.from('entities').insert({
    org_id: referredOrgId, name: catalogEntity.name, type: catalogEntity.type,
    hq_city: catalogEntity.hq_city, hq_country: catalogEntity.hq_country,
    website: catalogEntity.website, website_verified: !!catalogEntity.website,
    email: catalogEntity.email, email_domain: emailDomain, phone: catalogEntity.phone, address: catalogEntity.address,
    unverified_stub_at: hasEvidence ? null : new Date().toISOString(),
    stage_min: catalogEntity.stage_min, stage_max: catalogEntity.stage_max,
    check_min_eur: catalogEntity.check_min_eur, check_max_eur: catalogEntity.check_max_eur,
    sectors: catalogEntity.sectors, thesis: catalogEntity.thesis, fit_score: 'high', wave: 1,
    submission_channel_type: 'unknown', hard_filter_status: 'not_applicable', status: 'not_contacted',
    source: 'investor_invite',
  }).select('id').single();
  if (entityError || !newEntity) {
    console.error('[network-referrals-db] admitInvestorIntoReferredOrgPipeline: could not create entity', entityError?.message);
    return;
  }

  const { error: deliveryError } = await admin.from('catalog_deliveries').insert({
    org_id: referredOrgId, catalog_id: catalogEntityId, entity_id: newEntity.id, via_pack: null, quota_exempt: true,
  });
  if (deliveryError) console.error('[network-referrals-db] admitInvestorIntoReferredOrgPipeline: could not record delivery', deliveryError.message);
}
