// Normalized shape PlanCards/ComparisonTable/UpgradeConfirmModal render from.
// Deliberately NOT PlanRow or InvestorPlanRow directly — those are each
// domain's own source of truth (founder plans.ts PLANS, and the future
// Investor Workspace plan list), with their own fields (Stripe tiers, seat
// counts, etc.). Call sites adapt their own data into this shape; the three
// components below know nothing about founders, investors, or billing.

// Prompt 749 — "cada linha do card declara onde é aplicada... uma linha
// sem enforcedBy não compila": EnforcedBy is a required field on
// PlanCardItem, not optional, so a card item literal missing it is a real
// TypeScript compile error, not a runtime check someone has to remember to
// add. 'NOT_ENFORCED' names a line that makes a plan-specific claim with no
// backing gate today (kept on the card anyway because it's commercial
// language the product still wants to say, per the prompt's own
// instruction for the seat-count lines) — distinct from 'always-available',
// which means the feature is real and genuinely ungated, on purpose (not a
// broken promise, just not plan-differentiated).
export type EnforcedBy =
  | 'pipeline-unlock.ts'
  | 'matchdeal_tier_limits'
  | 'planEntitlements.reviewOptimization'
  | 'planEntitlements.reviewTopTierTools'
  | 'planEntitlements.aiComposer'
  | 'ai-credits-wallet'
  | 'always-available'
  | 'NOT_ENFORCED';

export interface PlanCardItem {
  text: string;
  enforcedBy: EnforcedBy;
}

export interface PlanCardSection {
  /** The top-level checkmark line — e.g. "1 user", "Smart Calendar", "Curated pipeline*". */
  title: string;
  /** What backs THIS section's own headline claim (its `title`) — required
   *  even when `items` is empty, so a standalone line (no nested items at
   *  all, e.g. "Smart Calendar") still can't skip declaring where it's
   *  applied. */
  enforcedBy: EnforcedBy;
  /** Nested sub-claims shown under the title, each with its own enforcedBy
   *  (e.g. the 3 AI-credit group names, or the 3 curated-pipeline lines).
   *  Empty for a section that's just its own title line. */
  items: PlanCardItem[];
  /** Small print under this section only — e.g. the curated-pipeline asterisk. */
  note?: string;
}

export interface PlanCardData {
  /** Stable key — a PlanTier, an InvestorPlanTier, whatever the caller uses. */
  id: string;
  name: string;
  tagline?: string;
  priceLabel: string;
  /** e.g. "billed monthly", "free forever" — shown small, under the price. */
  priceSubLabel?: string;
  /** Prompt 749 — "or €756/year", shown as its own line under priceSubLabel. */
  annualPriceLine?: string;
  /** Prompt 749 — "Equivalent to €63/month", shown as its own line under annualPriceLine. */
  annualPerMonthLine?: string;
  /**
   * FULL, independent feature list — everything this plan includes, not a
   * delta and not filtered against a previous tier. Prompt 749 replaces the
   * old flat `bullets: string[]` (with embedded `\n` + `·` sub-bullets) and
   * the "only show what's new since the previous tier" render logic this
   * component used to apply — every plan now states its complete offer.
   */
  sections: PlanCardSection[];
  /** Teal "Most popular" badge. */
  popular?: boolean;
  /** Orange "Best value" badge — a separate flag from `popular` rather than
   *  a shared "which one, and which color" field, since a caller may want
   *  neither, either, or (in principle) both on different cards. */
  bestPrice?: boolean;
  /** e.g. "🎉 Promo applied — you pay €43/month until 28 Oct 2026". Shown as
   *  a small highlighted line under the price when a founder has an active
   *  promo code covering this plan. Optional — most callers never set it. */
  promoNote?: string;
}

/**
 * Every item text in `plan` not present in `previous` — "what you gain by
 * upgrading," UpgradeConfirmModal's own purpose (distinct from, and kept
 * despite, Prompt 749 removing the CARD's own new-since-previous filter —
 * this modal's job is specifically to show the delta, the card's job is now
 * to show everything).
 */
function allClaimTexts(plan: PlanCardData): string[] {
  return plan.sections.flatMap((s) => [s.title, ...s.items.map((i) => i.text)]);
}

export function newItemsSince(plan: PlanCardData, previous: PlanCardData | undefined): Set<string> {
  const prevTexts = new Set(previous ? allClaimTexts(previous) : []);
  return new Set(allClaimTexts(plan).filter((t) => !prevTexts.has(t)));
}
