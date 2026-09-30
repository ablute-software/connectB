// Prompt I-01 §A.8 — redeem the voucher an incubator invite carries, with the
// same eligibility rules /api/promo/redeem applies (promoEligibility,
// "already redeemed", computeBenefitEndsAt; promo_redemptions written with
// the service role, as that route does). Deliberately not a refactor of
// that route: the founder's own redemption path stays byte-identical.
//
// Reachable only once I-02 gives promo codes an owner — until then the
// incubator_invites policies keep promo_code_id null, so no invite carries a
// voucher. I-02 unifies this with the protocol/voucher ledger.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { computeBenefitEndsAt, promoEligibility, type PromoCode } from './promo';
import type { VoucherOutcome } from './incubator-accept';

export async function redeemIncubatorInviteVoucher(
  admin: SupabaseClient, promoCodeId: string, orgId: string, userId: string,
): Promise<VoucherOutcome> {
  const { data: promo } = await admin.from('promo_codes').select('*').eq('id', promoCodeId).maybeSingle();
  const { count } = await admin.from('promo_redemptions')
    .select('id', { count: 'exact', head: true }).eq('promo_code_id', promoCodeId);
  const reason = promoEligibility(promo as PromoCode | null, count ?? 0, new Date());
  if (reason) return { ok: false, reason };

  const { data: existing } = await admin.from('promo_redemptions')
    .select('id').eq('promo_code_id', promoCodeId).eq('org_id', orgId).maybeSingle();
  if (existing) return { ok: false, reason: 'already_redeemed' };

  const redeemedAt = new Date();
  const benefitEndsAt = computeBenefitEndsAt(redeemedAt, (promo as PromoCode).benefit_duration_months ?? null);
  const { error } = await admin.from('promo_redemptions').insert({
    promo_code_id: promoCodeId, org_id: orgId, redeemed_by: userId,
    redeemed_at: redeemedAt.toISOString(),
    benefit_ends_at: benefitEndsAt ? benefitEndsAt.toISOString() : null,
  });
  if (error) return { ok: false, reason: error.code === '23505' ? 'already_redeemed' : 'insert_failed' };
  return { ok: true };
}
