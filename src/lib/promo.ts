// Promo Codes & Offers — pure, I/O-free core (mirrors billing.ts/plans.ts:
// deterministic given its inputs, unit-tested, no env reads, no Supabase
// client). The API routes (backoffice CRUD + founder redeem) compose these;
// the redemption-eligibility rule is defined once here so it can't drift
// between "can this code still be redeemed" checks done in different routes.
import type { PlanTier } from './types';

export type PromoKind = 'percent_off' | 'free_trial';

export interface PromoCode {
  id: string;
  code: string;
  label: string | null;
  kind: PromoKind;
  discount_pct: number;
  applicable_plans: PlanTier[];
  redeemable_until: string | null;
  benefit_duration_months: number | null;
  max_redemptions: number | null;
  active: boolean;
  deleted_at: string | null;
}

// Plans a promo can meaningfully apply to — 'idea' is already free.
export const PROMO_ELIGIBLE_PLANS: PlanTier[] = ['garage', 'motherfunding'];

export type PromoIneligibleReason =
  | 'not_found' | 'deleted' | 'inactive' | 'expired' | 'redemption_limit_reached' | 'already_redeemed';

/**
 * Whether a code can still be newly redeemed right now, independent of any
 * specific org. `redemptionCount` is the count of rows already in
 * promo_redemptions for this code — the caller queries that; this function
 * only applies the rule.
 */
export function promoEligibility(
  promo: Pick<PromoCode, 'active' | 'deleted_at' | 'redeemable_until' | 'max_redemptions'> | null,
  redemptionCount: number,
  now: Date,
): PromoIneligibleReason | null {
  if (!promo) return 'not_found';
  if (promo.deleted_at) return 'deleted';
  if (!promo.active) return 'inactive';
  if (promo.redeemable_until && new Date(promo.redeemable_until) < now) return 'expired';
  if (promo.max_redemptions != null && redemptionCount >= promo.max_redemptions) return 'redemption_limit_reached';
  return null;
}

// benefit_duration_months=null -> the discount never expires once redeemed.
export function computeBenefitEndsAt(redeemedAt: Date, benefitDurationMonths: number | null): Date | null {
  if (benefitDurationMonths == null) return null;
  const end = new Date(redeemedAt);
  end.setMonth(end.getMonth() + benefitDurationMonths);
  return end;
}

// Whether a redemption's benefit is still in effect right now (permanent
// benefits, benefit_ends_at=null, are always still in effect).
export function benefitStillActive(benefitEndsAt: string | null, now: Date): boolean {
  return benefitEndsAt == null || new Date(benefitEndsAt) > now;
}

// Whether a specific redemption is CURRENTLY granting its benefit —
// deliberately narrower than "is the promo code active": Deactivate and
// Delete mean two different things, confirmed by the founder (not the
// original design here, which wrongly conflated them):
//   - Deactivate (`active=false`) only blocks NEW redemptions going
//     forward. Anyone who already redeemed keeps their benefit until it
//     naturally expires — that's the whole point of "deactivate" rather
//     than "delete" existing as a separate, softer action.
//   - Delete (`deleted_at` set) is the one that revokes EVERY current
//     holder's benefit immediately, everywhere — the founder-facing Plans
//     page, the effective plan tier (plan-server.ts), and this promo's own
//     redemptions list. Irreversible, which is why the back-office delete
//     action requires typing DELETE to confirm (see promo-codes/page.tsx).
// So this function checks `deleted_at` only, never `active`.
export function isRedemptionCurrentlyActive(
  promo: Pick<PromoCode, 'deleted_at'> | null,
  benefitEndsAt: string | null,
  now: Date,
): boolean {
  if (!promo || promo.deleted_at) return false;
  return benefitStillActive(benefitEndsAt, now);
}

export function discountedPriceEur(originalEur: number, discountPct: number): number {
  return Math.round(originalEur * (100 - discountPct) / 100);
}

// kind='free_trial' forces the 100% case — enforced here so the backoffice
// create form and the API route agree on the same rule without duplicating it.
export function normalizeDiscountForKind(kind: PromoKind, discountPct: number): number {
  return kind === 'free_trial' ? 100 : discountPct;
}

// A short, human-typeable default if the admin doesn't type their own code —
// uppercase alnum, no ambiguous characters (0/O, 1/I/L) to avoid support
// tickets from a founder misreading a code shown on a phone.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export function generatePromoCode(length = 8): string {
  let out = '';
  for (let i = 0; i < length; i++) out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return out;
}

export function normalizePromoCodeInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}
