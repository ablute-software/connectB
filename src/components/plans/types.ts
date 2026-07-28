// Normalized shape PlanCards/ComparisonTable/UpgradeConfirmModal render from.
// Deliberately NOT PlanRow or InvestorPlanRow directly — those are each
// domain's own source of truth (founder plans.ts PLANS, and the future
// Investor Workspace plan list), with their own fields (Stripe tiers, seat
// counts, etc.). Call sites adapt their own data into this shape; the three
// components below know nothing about founders, investors, or billing.
export interface PlanCardData {
  /** Stable key — a PlanTier, an InvestorPlanTier, whatever the caller uses. */
  id: string;
  name: string;
  tagline?: string;
  priceLabel: string;
  /** e.g. "billed monthly", "free forever" — shown small, under the price. */
  priceSubLabel?: string;
  /**
   * FULL, cumulative feature list — everything this plan includes, not a
   * delta. Order matters: passing `plans` in ascending tier order lets
   * PlanCards diff consecutive entries to highlight what's new, and lets
   * ComparisonTable build its feature-row order from first appearance.
   */
  bullets: string[];
  /** Teal "Most popular" badge. */
  popular?: boolean;
  /** Orange "Best price" badge — a separate flag from `popular` rather than
   *  a shared "which one, and which color" field, since a caller may want
   *  neither, either, or (in principle) both on different cards. */
  bestPrice?: boolean;
  /** e.g. "🎉 Promo applied — you pay €43/month until 28 Oct 2026". Shown as
   *  a small highlighted line under the price when a founder has an active
   *  promo code covering this plan. Optional — most callers never set it. */
  promoNote?: string;
}

/** Bullets in `plan` not present in `previous` — "what you gain" either way this is used. */
export function newBulletsSince(plan: PlanCardData, previous: PlanCardData | undefined): Set<string> {
  const prevSet = new Set(previous?.bullets ?? []);
  return new Set(plan.bullets.filter((b) => !prevSet.has(b)));
}
