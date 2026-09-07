// Prompt 601 — platform badges, pure core (no I/O, unit-tested; the server
// composition lives in platform-badges-server.ts, same split as
// pioneer.ts/pioneer-server.ts and promo.ts).
//
// These are PLATFORM STATUSES tied to commercial rights — deliberately a
// different thing from `company_badges` (§A), which is the company's own
// verifiable awards, with evidence documents and a verification state, and
// is what investors see. Nothing in this module is ever investor-visible:
// the only investor-side effect is the rank boost (§G), which carries no
// mark (Nuno's decision §B.2).
//
// Phase 1 (this prompt): tech master and pioneer, granted by hand. Phase 2
// (specified, not built): Sedulous / Dyed-in-the-wool / Toughness are
// computed; their keys exist here so the schema, the icons and the
// importance ladder (§H) are already in place.
import type { PlanTier } from './types';
import { PLAN_TIERS } from './plans';
import { PIONEER_LIFETIME_DISCOUNT_PCT, PIONEER_STRIPE_COUPON_ID } from './pioneer';

export const PLATFORM_BADGES = ['tech_master', 'pioneer', 'sedulous', 'dyed_in_the_wool', 'toughness'] as const;
export type PlatformBadgeKey = (typeof PLATFORM_BADGES)[number];

/** The two Phase-1 badges: cohort statuses an admin assigns; never computed. */
export const MANUAL_BADGES: readonly PlatformBadgeKey[] = ['tech_master', 'pioneer'];

/** §H — the icon ladder, simplest to most elaborate. */
export const BADGE_IMPORTANCE: Record<PlatformBadgeKey, number> = {
  toughness: 1, dyed_in_the_wool: 2, sedulous: 3, pioneer: 4, tech_master: 5,
};

export const BADGE_LABEL: Record<PlatformBadgeKey, string> = {
  tech_master: 'tech master', pioneer: 'pioneer', sedulous: 'Sedulous',
  dyed_in_the_wool: 'Dyed-in-the-wool', toughness: 'Toughness',
};

export const BADGE_SHORT: Record<PlatformBadgeKey, string> = {
  tech_master: 'Testers between alpha and beta. Free forever while the app is used at least once every 2 months.',
  pioneer: 'Beta-test cohort. Free during the offer period, then at least 25% off, forever.',
  sedulous: 'One unit per week in which the weekly outreach goal was met (Phase 2, computed).',
  dyed_in_the_wool: 'App used on at least 60 days in a window of 85 consecutive days (Phase 2, computed).',
  toughness: 'App used on at least 15 days in a window of 25 consecutive days (Phase 2, computed).',
};

// §C — "pelo menos uma vez a cada 2 meses". 61 days rather than a calendar
// arithmetic on months, so the window is the same length whichever month
// it starts in and the percentages below are stable.
export const TECH_MASTER_WINDOW_DAYS = 61;
export const TECH_MASTER_WARNING_PCTS: readonly number[] = [75, 90, 98];
// A "use" is a usage_sessions row with real activity, not a bare page load
// — Phase 2's own question ("um login vazio é gratuito de fingir"), applied
// here already. One minute of activity is the floor; parameter, not magic.
export const TECH_MASTER_MIN_ACTIVE_SECONDS = 60;
// Decided alone (recorded in the 601 report): "grátis para sempre" grants
// the top tier's entitlements — the free tier ('idea') is already free, so
// a tech master on 'idea' would hold a badge that gives nothing.
export const TECH_MASTER_FREE_TIER: PlanTier = 'motherfunding';

// §B.1 — pioneer: 25% MINIMUM, forever. ONE number: pioneer.ts's constant
// was 20 (Prompt 161) and is raised there, so the legacy pioneer path and
// this one can never disagree.
export const PIONEER_MIN_DISCOUNT_PCT = PIONEER_LIFETIME_DISCOUNT_PCT;

// Stripe coupon ids — deterministic (create-or-reuse, the same idempotency
// scheme checkout/route.ts uses for promo coupons). Coupons are immutable
// in Stripe, so the percentage is part of the id: a changed percentage is
// a new coupon, never a silently different old one.
export const BADGE_COUPON_TECH_MASTER = 'platform-badge-tech-master-free';
export const BADGE_COUPON_PIONEER = PIONEER_STRIPE_COUPON_ID;

export interface PlatformBadgeRow {
  /** null for the legacy orgs.pioneer_badge flag (Prompt 161), surfaced as a pioneer row. */
  id: string | null;
  badge: PlatformBadgeKey;
  grantedAt: string;
  justification: string | null;
  /** Tier held for free while the free period applies (null = no free period). */
  freeTier: PlanTier | null;
  /** End of the free period; null with a freeTier means "forever" (tech master). */
  freeUntil: string | null;
  discountPct: number | null;
  revokedAt: string | null;
  lapsedAt: string | null;
  lapseReviewedAt: string | null;
  lastWarningPct: number;
  sedulousCount: number;
  legacy?: boolean;
}

export function isBadgeActive(row: Pick<PlatformBadgeRow, 'revokedAt'>): boolean {
  return row.revokedAt == null;
}

export function freePeriodActive(row: Pick<PlatformBadgeRow, 'freeTier' | 'freeUntil' | 'revokedAt'>, now: Date): boolean {
  if (!isBadgeActive(row) || !row.freeTier) return false;
  return row.freeUntil == null || new Date(row.freeUntil) > now;
}

function tierRank(t: PlanTier): number {
  return PLAN_TIERS.indexOf(t);
}

/**
 * The highest tier any active badge grants for free right now, or null.
 * Read-time only (plan-server.ts), like the free-trial boost: nothing is
 * written, so it reverts by itself the moment a free period ends.
 */
export function freeTierFromBadges(rows: PlatformBadgeRow[], now: Date): PlanTier | null {
  let best: PlanTier | null = null;
  for (const r of rows) {
    if (!freePeriodActive(r, now)) continue;
    const tier = r.freeTier!;
    if (!best || tierRank(tier) > tierRank(best)) best = tier;
  }
  return best;
}

/**
 * §E — why checkout must not proceed: a founder whose badge makes the plan
 * free has nothing to pay, and a subscription created now would charge
 * them later. The message is what the Plans page shows.
 */
export function checkoutBlockedReason(rows: PlatformBadgeRow[], now: Date): string | null {
  const tm = rows.find((r) => r.badge === 'tech_master' && isBadgeActive(r));
  if (tm) return 'Sherlock is free for you as a tech master — there is nothing to pay.';
  const pioneerFree = rows.find((r) => r.badge === 'pioneer' && freePeriodActive(r, now));
  if (pioneerFree) {
    return pioneerFree.freeUntil
      ? `Your pioneer offer keeps Sherlock free until ${formatDate(pioneerFree.freeUntil)} — nothing to pay until then.`
      : 'Your pioneer offer keeps Sherlock free — there is nothing to pay.';
  }
  return null;
}

/**
 * §E — the Stripe coupon a badge earns on a paid subscription. Tech master:
 * 100% forever (an existing subscription at grant time is discounted to
 * zero rather than cancelled, so the record survives). Pioneer, once the
 * free period is over: 25% forever. "Mínimo": the caller compares this with
 * any active promo and the better one wins.
 */
export function badgeCouponFor(rows: PlatformBadgeRow[], now: Date): { id: string; percentOff: number } | null {
  if (rows.some((r) => r.badge === 'tech_master' && isBadgeActive(r))) {
    return { id: BADGE_COUPON_TECH_MASTER, percentOff: 100 };
  }
  const pioneer = rows.find((r) => r.badge === 'pioneer' && isBadgeActive(r));
  if (pioneer && !freePeriodActive(pioneer, now)) {
    return { id: BADGE_COUPON_PIONEER, percentOff: pioneer.discountPct ?? PIONEER_MIN_DISCOUNT_PCT };
  }
  return null;
}

export interface TechMasterWindow {
  /** The moment the 2-month window started: the last qualifying use, or the grant if none since. */
  anchorAt: string;
  deadlineAt: string;
  /** 0–100+, one decimal; ≥100 means the window has passed. */
  elapsedPct: number;
  daysLeft: number;
  lapsed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function techMasterWindow(row: Pick<PlatformBadgeRow, 'grantedAt'>, lastUseIso: string | null, now: Date): TechMasterWindow {
  const granted = new Date(row.grantedAt).getTime();
  const lastUse = lastUseIso ? new Date(lastUseIso).getTime() : null;
  // A use BEFORE the grant is not a use of the status — the clock starts
  // at the grant at the earliest.
  const anchor = lastUse != null && lastUse > granted ? lastUse : granted;
  const deadline = anchor + TECH_MASTER_WINDOW_DAYS * DAY_MS;
  const elapsed = Math.max(0, now.getTime() - anchor) / (TECH_MASTER_WINDOW_DAYS * DAY_MS) * 100;
  return {
    anchorAt: new Date(anchor).toISOString(),
    deadlineAt: new Date(deadline).toISOString(),
    elapsedPct: Math.round(elapsed * 10) / 10,
    daysLeft: Math.max(0, Math.ceil((deadline - now.getTime()) / DAY_MS)),
    lapsed: now.getTime() >= deadline,
  };
}

/**
 * Which warning (75/90/98) is due now and not yet sent. Returns the highest
 * threshold reached that is above the last one sent — so a window that
 * jumps from 70% to 99% between two daily ticks sends ONE email (98), not
 * three.
 */
export function warningDue(elapsedPct: number, lastWarningPct: number): number | null {
  let due: number | null = null;
  for (const pct of TECH_MASTER_WARNING_PCTS) {
    if (elapsedPct >= pct && pct > lastWarningPct) due = pct;
  }
  return due;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** §D.1 — what the status gives, in plain words. The founder must not have to ask. */
export function rightsText(row: PlatformBadgeRow, now: Date): string {
  switch (row.badge) {
    case 'tech_master':
      return 'Free forever, as long as you use Sherlock at least once every 2 months.';
    case 'pioneer': {
      const pct = row.discountPct ?? PIONEER_MIN_DISCOUNT_PCT;
      if (freePeriodActive(row, now) && row.freeUntil) {
        return `Free until ${formatDate(row.freeUntil)}, then at least ${pct}% off any paid plan, forever.`;
      }
      return `At least ${pct}% off any paid plan, forever. If a better promotion applies, the better one wins.`;
    }
    case 'sedulous':
      return `${row.sedulousCount} week${row.sedulousCount === 1 ? '' : 's'} in which the outreach goal was met.`;
    case 'dyed_in_the_wool':
      return 'Sherlock used on at least 60 of 85 consecutive days.';
    case 'toughness':
      return 'Sherlock used on at least 15 of 25 consecutive days.';
  }
}

export function sortByImportance(rows: PlatformBadgeRow[]): PlatformBadgeRow[] {
  return [...rows].sort((a, b) => BADGE_IMPORTANCE[b.badge] - BADGE_IMPORTANCE[a.badge]);
}

/** §G — the boost badges; the SQL side reads the same list from platform_badge_rank_params(). */
export const RANK_BOOST_BADGES: readonly PlatformBadgeKey[] = ['tech_master', 'pioneer'];

export function hasRankBoost(rows: PlatformBadgeRow[]): boolean {
  return rows.some((r) => isBadgeActive(r) && RANK_BOOST_BADGES.includes(r.badge));
}
