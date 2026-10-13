// Prompt 914 — the ONE definition of "the plan this org is on right now", pure (no I/O): the stored plan (orgs.plan), raised by the best
// 100%-off free trial still running and by the best free tier a platform badge grants. It used to live inside resolveUserPlan
// (plan-server.ts), so only the routes that called THAT saw a voucher; everything that read orgs.plan directly — the investor
// quota, the monthly delivery, the AI wallet — treated an org on a free trial of "It's the butler!" as "Elementary". The SQL twin of
// this file is effective_plan(uuid) (migration 20261013170000_effective_plan.sql); the parity cases in effective-plan-cases.json run
// against BOTH, and a drift test keeps the generated SQL honest.
//
// Nothing here writes anything: the boost is computed on every read and reverts by itself when the free period ends — no cron, nothing
// to clean up (the rule plan-server.ts always had, and the reason a voucher never writes orgs.plan).
//
// Two rules that are decisions, not accidents (both from the code this replaces, kept exactly):
//  - only a 100%-off redemption grants entitlements. A partial discount (30% off) still has to be subscribed to at the discounted price;
//    only a 0-euro redemption has no payment gap left to bridge.
//  - the code being DELETED revokes the benefit for every holder; the code being DEACTIVATED (active = false) only stops new
//    redemptions — whoever already redeemed keeps it until it runs out (promo.ts: isRedemptionCurrentlyActive checks deleted_at, never
//    active). A prompt's prose that lists `active` among the conditions is describing the code's "can be redeemed", not "is granting".
import { PLAN_TIERS, normalizePlan } from './plans';
import { isRedemptionCurrentlyActive } from './promo';
import { BADGE_LABEL, freePeriodActive, type PlatformBadgeKey } from './platform-badges';
import type { PlanTier } from './types';

export type PlanOrigin =
  | { kind: 'stored' }
  | { kind: 'free_trial'; code: string; until: string | null }
  | { kind: 'badge'; badge: PlatformBadgeKey; until: string | null };

export interface EffectivePlan {
  /** The plan the org is entitled to right now. */
  plan: PlanTier;
  /** What orgs.plan says (normalised) — what the org is subscribed to, or the free tier. */
  stored: PlanTier;
  /** Why `plan` is what it is: nothing special (stored), a free trial, or a platform badge. */
  origin: PlanOrigin;
}

/** One promo_redemptions row with the promo_codes columns the rule reads (the shape PostgREST returns for the embedded select). */
export interface TrialRedemptionRow {
  benefit_ends_at: string | null;
  promo_codes: { code: string; discount_pct: number; applicable_plans: string[] | null; deleted_at: string | null } | null;
}

/** One platform_badges row (active ones only are read, but the rule re-checks revoked_at). */
export interface BadgeFreeRow {
  badge: string;
  free_tier: string | null;
  free_until: string | null;
  revoked_at: string | null;
}

const rank = (t: PlanTier): number => PLAN_TIERS.indexOf(t);
const isTier = (v: unknown): v is PlanTier => typeof v === 'string' && (PLAN_TIERS as string[]).includes(v);

/** A later end wins a tie between two sources of the same tier — only the origin text depends on it, never the tier. null = never ends. */
function endsLater(a: string | null, b: string | null): boolean {
  if (a == null) return b != null;
  if (b == null) return false;
  return new Date(a).getTime() > new Date(b).getTime();
}

export interface FreeTrial { tier: PlanTier; code: string; until: string | null }

/** The best tier a still-running 100%-off redemption covers, with the code and the end date it came from. */
export function bestFreeTrial(rows: TrialRedemptionRow[] | null | undefined, now: Date): FreeTrial | null {
  let best: FreeTrial | null = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    const promo = r.promo_codes;
    if (!isRedemptionCurrentlyActive(promo, r.benefit_ends_at, now)) continue;
    if (!promo || promo.discount_pct !== 100) continue;
    for (const tier of promo.applicable_plans ?? []) {
      // A tier this code does not know (applicable_plans is free text in the database) never wins: it ranks below every real tier.
      if (!isTier(tier)) continue;
      if (!best || rank(tier) > rank(best.tier) || (rank(tier) === rank(best.tier) && endsLater(r.benefit_ends_at, best.until))) {
        best = { tier, code: promo.code, until: r.benefit_ends_at };
      }
    }
  }
  return best;
}

export interface FreeBadge { tier: PlanTier; badge: PlatformBadgeKey; until: string | null }

/** The best tier a platform badge grants for free right now (freeTierFromBadges' rule, with the badge it came from). */
export function bestFreeBadge(rows: BadgeFreeRow[] | null | undefined, now: Date): FreeBadge | null {
  let best: FreeBadge | null = null;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (!isTier(r.free_tier)) continue;
    if (!freePeriodActive({ freeTier: r.free_tier, freeUntil: r.free_until, revokedAt: r.revoked_at }, now)) continue;
    if (!best || rank(r.free_tier) > rank(best.tier) || (rank(r.free_tier) === rank(best.tier) && endsLater(r.free_until, best.until))) {
      best = { tier: r.free_tier, badge: r.badge as PlatformBadgeKey, until: r.free_until };
    }
  }
  return best;
}

/** The decision itself: stored ⊕ free trial ⊕ badge, the highest tier wins; a tie keeps the earlier source (stored, then trial). */
export function resolveEffectivePlan(storedRaw: string | null | undefined, trial: FreeTrial | null, badge: FreeBadge | null): EffectivePlan {
  const stored = normalizePlan(storedRaw);
  let plan = stored;
  let origin: PlanOrigin = { kind: 'stored' };
  if (trial && rank(trial.tier) > rank(plan)) { plan = trial.tier; origin = { kind: 'free_trial', code: trial.code, until: trial.until }; }
  if (badge && rank(badge.tier) > rank(plan)) { plan = badge.tier; origin = { kind: 'badge', badge: badge.badge, until: badge.until }; }
  return { plan, stored, origin };
}

/** The convenience the callers that only need the tier use. */
export function effectivePlanFromRows(
  storedRaw: string | null | undefined, redemptions: TrialRedemptionRow[] | null | undefined, badges: BadgeFreeRow[] | null | undefined, now: Date,
): EffectivePlan {
  return resolveEffectivePlan(storedRaw, bestFreeTrial(redemptions, now), bestFreeBadge(badges, now));
}

/**
 * The words that say WHY the plan is what it is — the answer to "I redeemed a code and it still says Elementary". Empty for a plan
 * that is simply the stored one. `fmt` formats an ISO date (the screens pass their own short date).
 */
export function describePlanOrigin(origin: PlanOrigin, fmt: (iso: string) => string): string {
  if (origin.kind === 'free_trial') return `free trial via ${origin.code}${origin.until ? ` until ${fmt(origin.until)}` : ' (no end date)'}`;
  if (origin.kind === 'badge') return `free through your ${BADGE_LABEL[origin.badge] ?? origin.badge} status${origin.until ? ` until ${fmt(origin.until)}` : ''}`;
  return '';
}
