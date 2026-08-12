// Prompt 161 — Pioneer campaign, pure/I/O-free core (mirrors promo.ts: no
// env reads, no Supabase client, unit-tested). pioneer-server.ts composes
// these with real DB reads/writes.

// §D.1 — "3 codes nominais por Pioneer".
export const PIONEER_REFERRAL_CODE_COUNT = 3;
// §D.1 — the prompt's own suggestion ("sugestão: 3 meses, como os codes
// públicos, já que são distribuídos por um Pioneer e não por um canal
// institucional") — no counter-decision recorded, implemented as stated.
export const PIONEER_REFERRAL_VALIDITY_MONTHS = 3;
// §C.3 — "20% de desconto vitalício em qualquer plano pago futuro", per
// pioneer_promessa_texto_final_20260810.md (copy file, not read directly by
// this session — the percentage is the only number this code needs from it,
// and is stated verbatim in the prompt itself).
export const PIONEER_LIFETIME_DISCOUNT_PCT = 20;
// Deterministic Stripe coupon id — one shared coupon for every Pioneer,
// not one per org (the discount is a flat, org-independent 20% forever),
// mirroring checkout/route.ts's own `promo-${promo.id}` id scheme for
// per-promo coupons (ensureStripeCoupon, Prompt 163 B) but keyed on the
// campaign itself since there's no promo_codes row to key it to here.
export const PIONEER_STRIPE_COUPON_ID = 'pioneer-badge-lifetime-20';

/**
 * Whether a promo_redemptions row (whose promo_codes.is_pioneer is true)
 * has reached the point where the org should permanently receive
 * pioneer_badge — i.e. its benefit has actually expired. A permanent
 * (benefit_ends_at = null) Pioneer redemption never triggers this — nothing
 * to "expire into" a badge for; the org's entitlement was never time-boxed
 * in the first place, so there's no expiry moment to capture (this can't
 * currently happen for a campaign code, which always sets
 * benefit_duration_months, but the function stays correct regardless of
 * how a future code might be configured).
 */
export function isPioneerBadgeDue(promoIsPioneer: boolean, benefitEndsAt: string | null, now: Date): boolean {
  if (!promoIsPioneer || benefitEndsAt == null) return false;
  return new Date(benefitEndsAt) <= now;
}

export interface ReferralCodeDraft {
  code: string;
  label: string;
  kind: 'free_trial';
  discount_pct: 100;
  applicable_plans: string[];
  benefit_duration_months: number;
  max_redemptions: 1;
  is_pioneer: true;
  referral_of_org_id: string;
}

/**
 * The 3 referral codes an org receives on becoming Pioneer — same
 * applicable_plans as whichever code originally granted THEM Pioneer
 * status (so the referral chain keeps offering the same tier down the
 * line), is_pioneer=true (so a referred org can itself become Pioneer and
 * refer further — §D's own end-to-end test: "um desses codes redimido por
 * outra conta repete o ciclo"). generateCode is injected (never
 * Math.random() called directly in this pure module) so this stays
 * deterministic and testable — pioneer-server.ts passes generatePromoCode
 * (promo.ts) in production.
 */
export function buildReferralCodeDrafts(
  orgId: string, originatingApplicablePlans: string[], generateCode: () => string,
): ReferralCodeDraft[] {
  const plans = originatingApplicablePlans.length ? originatingApplicablePlans : ['garage'];
  return Array.from({ length: PIONEER_REFERRAL_CODE_COUNT }, () => ({
    code: generateCode(),
    label: 'Pioneer referral',
    kind: 'free_trial' as const,
    discount_pct: 100 as const,
    applicable_plans: plans,
    benefit_duration_months: PIONEER_REFERRAL_VALIDITY_MONTHS,
    max_redemptions: 1 as const,
    is_pioneer: true as const,
    referral_of_org_id: orgId,
  }));
}
