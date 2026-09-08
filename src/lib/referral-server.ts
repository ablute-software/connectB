// Prompt 854 §C.2 — server-side orchestration for the platform-wide
// referral pyramid. Pure decision logic lives in referral.ts; this file is
// only the DB reads/writes composing it, same split as pioneer-server.ts/
// pioneer.ts (and every other *-server.ts pair in this codebase).
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildReferralCodeDrafts } from './referral';
import { generatePromoCode } from './promo';

export interface GrantReferralResult {
  codesCreated: number;
}

/**
 * Grants an org its REFERRAL_CODE_COUNT codes, once per org ever — the same
 * existence-check shape pioneer-server.ts's grantPioneerBadgeAndReferrals
 * uses, for the same reason: an org that redeems two (or more) codes over
 * time does not get a second set. Idempotent, safe to call repeatedly.
 *
 * Callers are the guards, not this function: /api/promo/redeem only calls
 * this when the redeemed code is NOT is_pioneer (guard 1 — a Pioneer org is
 * on the 3×100% path, pioneer-server.ts, never this one) and wraps the call
 * so a failure here never fails the redemption itself (guard 4). Guard 3
 * (never for your own code) is checked before the redemption is even
 * inserted, in the route.
 */
export async function grantReferralCodes(
  admin: SupabaseClient, orgId: string, applicablePlans: string[],
): Promise<GrantReferralResult> {
  const { count: existingReferrals } = await admin
    .from('promo_codes').select('id', { count: 'exact', head: true }).eq('referral_of_org_id', orgId);
  if ((existingReferrals ?? 0) > 0) return { codesCreated: 0 };

  const drafts = buildReferralCodeDrafts(orgId, applicablePlans, generatePromoCode);
  const { error } = await admin.from('promo_codes').insert(drafts);
  return { codesCreated: error ? 0 : drafts.length };
}
