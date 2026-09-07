import { describe, it, expect } from 'vitest';
import {
  badgeCouponFor, checkoutBlockedReason, freeTierFromBadges, hasRankBoost, rightsText, techMasterWindow, warningDue,
  BADGE_COUPON_PIONEER, BADGE_COUPON_TECH_MASTER, PIONEER_MIN_DISCOUNT_PCT, TECH_MASTER_WINDOW_DAYS,
  type PlatformBadgeRow,
} from './platform-badges';

const now = new Date('2026-09-07T12:00:00Z');

function row(over: Partial<PlatformBadgeRow>): PlatformBadgeRow {
  return {
    id: 'b1', badge: 'tech_master', grantedAt: '2026-09-01T00:00:00Z', justification: 'tester',
    freeTier: 'motherfunding', freeUntil: null, discountPct: null,
    revokedAt: null, lapsedAt: null, lapseReviewedAt: null, lastWarningPct: 0, sedulousCount: 0,
    ...over,
  };
}

describe('Prompt 601 — platform badges, pure core', () => {
  it('§B.1: the pioneer minimum is 25%, one constant shared with the legacy pioneer path', () => {
    expect(PIONEER_MIN_DISCOUNT_PCT).toBe(25);
    expect(BADGE_COUPON_PIONEER).toContain('25');
  });

  it('tech master grants the top tier for free with no end date', () => {
    expect(freeTierFromBadges([row({})], now)).toBe('motherfunding');
    expect(checkoutBlockedReason([row({})], now)).toMatch(/nothing to pay/);
    expect(badgeCouponFor([row({})], now)).toEqual({ id: BADGE_COUPON_TECH_MASTER, percentOff: 100 });
  });

  it('a revoked badge grants nothing', () => {
    const r = row({ revokedAt: '2026-09-05T00:00:00Z' });
    expect(freeTierFromBadges([r], now)).toBeNull();
    expect(checkoutBlockedReason([r], now)).toBeNull();
    expect(badgeCouponFor([r], now)).toBeNull();
    expect(hasRankBoost([r])).toBe(false);
  });

  it('pioneer inside the free period: free tier, checkout blocked, no coupon yet', () => {
    const r = row({ badge: 'pioneer', freeTier: 'garage', freeUntil: '2026-12-01T00:00:00Z', discountPct: 25 });
    expect(freeTierFromBadges([r], now)).toBe('garage');
    expect(checkoutBlockedReason([r], now)).toMatch(/until 01 Dec 2026/);
    expect(badgeCouponFor([r], now)).toBeNull();
    expect(rightsText(r, now)).toBe('Free until 01 Dec 2026, then at least 25% off any paid plan, forever.');
  });

  it('pioneer after the free period: no free tier, 25% forever coupon', () => {
    const r = row({ badge: 'pioneer', freeTier: 'garage', freeUntil: '2026-08-01T00:00:00Z', discountPct: 25 });
    expect(freeTierFromBadges([r], now)).toBeNull();
    expect(checkoutBlockedReason([r], now)).toBeNull();
    expect(badgeCouponFor([r], now)).toEqual({ id: BADGE_COUPON_PIONEER, percentOff: 25 });
    expect(rightsText(r, now)).toMatch(/^At least 25% off any paid plan, forever\./);
  });

  it('the legacy orgs.pioneer_badge flag reads as a pioneer with no free period', () => {
    const r = row({ id: null, badge: 'pioneer', freeTier: null, freeUntil: null, discountPct: 25, legacy: true });
    expect(freeTierFromBadges([r], now)).toBeNull();
    expect(badgeCouponFor([r], now)).toEqual({ id: BADGE_COUPON_PIONEER, percentOff: 25 });
    expect(hasRankBoost([r])).toBe(true);
  });

  it('tech master wins over pioneer when both are held', () => {
    const rows = [row({ badge: 'pioneer', freeTier: null, discountPct: 25 }), row({})];
    expect(badgeCouponFor(rows, now)?.percentOff).toBe(100);
    expect(freeTierFromBadges(rows, now)).toBe('motherfunding');
  });

  describe('techMasterWindow', () => {
    it('anchors on the last qualifying use and runs 61 days', () => {
      const w = techMasterWindow(row({ grantedAt: '2026-06-01T00:00:00Z' }), '2026-08-08T12:00:00Z', now);
      expect(TECH_MASTER_WINDOW_DAYS).toBe(61);
      expect(w.anchorAt).toBe('2026-08-08T12:00:00.000Z');
      expect(w.deadlineAt).toBe('2026-10-08T12:00:00.000Z');
      expect(w.elapsedPct).toBe(49.2);
      expect(w.daysLeft).toBe(31);
      expect(w.lapsed).toBe(false);
    });

    it('a use before the grant does not count — the clock starts at the grant', () => {
      const w = techMasterWindow(row({ grantedAt: '2026-09-01T00:00:00Z' }), '2026-08-20T00:00:00Z', now);
      expect(w.anchorAt).toBe('2026-09-01T00:00:00.000Z');
    });

    it('no use at all anchors on the grant', () => {
      const w = techMasterWindow(row({ grantedAt: '2026-09-01T00:00:00Z' }), null, now);
      expect(w.anchorAt).toBe('2026-09-01T00:00:00.000Z');
      expect(w.elapsedPct).toBe(10.7);
    });

    it('past the deadline: lapsed, 0 days left, pct above 100', () => {
      const w = techMasterWindow(row({ grantedAt: '2026-06-01T00:00:00Z' }), '2026-06-15T00:00:00Z', now);
      expect(w.lapsed).toBe(true);
      expect(w.daysLeft).toBe(0);
      expect(w.elapsedPct).toBeGreaterThan(100);
    });
  });

  describe('warningDue', () => {
    it('walks 75 → 90 → 98 once each', () => {
      expect(warningDue(50, 0)).toBeNull();
      expect(warningDue(76, 0)).toBe(75);
      expect(warningDue(76, 75)).toBeNull();
      expect(warningDue(91, 75)).toBe(90);
      expect(warningDue(98.5, 90)).toBe(98);
      expect(warningDue(120, 98)).toBeNull();
    });

    it('a jump across several thresholds sends one warning, the highest', () => {
      expect(warningDue(99, 0)).toBe(98);
    });
  });
});
