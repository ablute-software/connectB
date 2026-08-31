// Prompt 497 — the server half of the seat limit: count what's actually
// linked, resolve the firm's tier, hand both to plans.ts's pure
// checkInvestorSeatLimit(). Shared so the two routes that can add a seat to
// an ALREADY-EXISTING firm (portal/investor-profile/link — the investor
// links themselves; backoffice/investor-entity-claims/[id]/approve — an
// admin approves a claim) can't drift into two different counts.
//
// The other two seat writers (portal/investor-profile/add-firm and
// /self-declare) each create a brand-new catalog_entities row in the same
// request and link exactly one person to it, so they can never exceed any
// tier's limit (min 1 seat) — deliberately left ungated rather than given
// a check that can only ever pass. The migration 0285 trigger still covers
// them, and would catch it if that invariant ever changed.
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  MATCHDEAL_TIER_TO_INVESTOR_PLAN, checkInvestorSeatLimit,
  type InvestorPlanTier, type InvestorSeatVerdict,
} from './plans';

/** MatchDeal's internal default, mirrored from investor-pipeline.ts / portal-access.ts. */
const DEFAULT_MATCHDEAL_TIER = 'tier_a';

/**
 * The firm's plan tier, using investorOrgRows()'s own "first member with a
 * value" convention — plan is one firm-level value even though the column
 * technically lives per seat on matchdeal_profiles. Falls back to
 * 'pro_scout' (1 seat) when no member carries a tier, same fail-closed
 * default as every other tier lookup in the codebase.
 */
export async function resolveFirmPlanTier(
  admin: SupabaseClient, catalogEntityId: string,
): Promise<InvestorPlanTier> {
  // Ordered by created_at so this and migration 0285's
  // matchdeal_firm_plan_tier() resolve the SAME seat's tier — "first with a
  // value" is only deterministic if both halves agree on what "first" is.
  const { data: members } = await admin.from('matchdeal_investor_members')
    .select('id').eq('catalog_entity_id', catalogEntityId).eq('status', 'active')
    .order('created_at', { ascending: true });
  const memberIds = (members ?? []).map((m) => m.id as string);
  if (!memberIds.length) return MATCHDEAL_TIER_TO_INVESTOR_PLAN[DEFAULT_MATCHDEAL_TIER];

  const { data: profiles } = await admin.from('matchdeal_profiles')
    .select('membership_id, plan_tier').eq('kind', 'investor').in('membership_id', memberIds);
  const tierByMember = new Map((profiles ?? []).map((p) => [p.membership_id as string, p.plan_tier as string | null]));
  const tier = memberIds.map((id) => tierByMember.get(id)).find(Boolean) ?? DEFAULT_MATCHDEAL_TIER;
  return MATCHDEAL_TIER_TO_INVESTOR_PLAN[tier] ?? MATCHDEAL_TIER_TO_INVESTOR_PLAN[DEFAULT_MATCHDEAL_TIER];
}

/**
 * Can `userId` take a seat on `catalogEntityId` right now? A user who
 * already holds an active seat on this firm is always allowed: re-linking
 * (the link route upserts on (user_id, catalog_entity_id)) is a no-op
 * write, not a new seat.
 */
export async function checkSeatAvailable(
  admin: SupabaseClient, catalogEntityId: string, userId: string,
): Promise<InvestorSeatVerdict> {
  const [{ data: members }, tier] = await Promise.all([
    admin.from('matchdeal_investor_members')
      .select('user_id').eq('catalog_entity_id', catalogEntityId).eq('status', 'active'),
    resolveFirmPlanTier(admin, catalogEntityId),
  ]);
  const seats = (members ?? []).map((m) => m.user_id as string);

  // Already seated here -> not a new seat, allowed unconditionally. This is
  // NOT the same as merely excluding their own row from the count: on a firm
  // that is already AT or OVER its limit, the remaining seats still reach it
  // and would refuse the re-link. Caught empirically against production data
  // before this shipped (the QA firm at 2 seats on a 1-seat tier refused its
  // own owner's re-link). The verdict is reported with the seats the firm
  // actually has, so a caller logging it sees the true state.
  const used = seats.filter((id) => id !== userId).length;
  if (seats.includes(userId)) {
    return { ...checkInvestorSeatLimit({ tier, used: 0 }), used, allowed: true, reason: null };
  }
  return checkInvestorSeatLimit({ tier, used });
}
