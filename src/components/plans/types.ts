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
  popular?: boolean;
}

/** Bullets in `plan` not present in `previous` — "what you gain" either way this is used. */
export function newBulletsSince(plan: PlanCardData, previous: PlanCardData | undefined): Set<string> {
  const prevSet = new Set(previous?.bullets ?? []);
  return new Set(plan.bullets.filter((b) => !prevSet.has(b)));
}
