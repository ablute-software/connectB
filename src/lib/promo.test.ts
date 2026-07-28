import { describe, expect, it } from 'vitest';
import {
  promoEligibility, computeBenefitEndsAt, benefitStillActive, discountedPriceEur,
  normalizeDiscountForKind, normalizePromoCodeInput, generatePromoCode,
} from './promo';

const NOW = new Date('2026-07-28T12:00:00Z');
const basePromo = {
  active: true, deleted_at: null as string | null,
  redeemable_until: null as string | null, max_redemptions: null as number | null,
};

describe('promoEligibility', () => {
  it('is eligible when active, not deleted, not expired, under the limit', () => {
    expect(promoEligibility(basePromo, 0, NOW)).toBeNull();
  });

  it('null promo -> not_found', () => {
    expect(promoEligibility(null, 0, NOW)).toBe('not_found');
  });

  it('deleted_at set -> deleted, even if active', () => {
    expect(promoEligibility({ ...basePromo, deleted_at: '2026-01-01T00:00:00Z' }, 0, NOW)).toBe('deleted');
  });

  it('active=false -> inactive', () => {
    expect(promoEligibility({ ...basePromo, active: false }, 0, NOW)).toBe('inactive');
  });

  it('redeemable_until in the past -> expired', () => {
    expect(promoEligibility({ ...basePromo, redeemable_until: '2026-01-01T00:00:00Z' }, 0, NOW)).toBe('expired');
  });

  it('redeemable_until in the future -> still eligible', () => {
    expect(promoEligibility({ ...basePromo, redeemable_until: '2027-01-01T00:00:00Z' }, 0, NOW)).toBeNull();
  });

  it('redemptionCount at max_redemptions -> redemption_limit_reached', () => {
    expect(promoEligibility({ ...basePromo, max_redemptions: 10 }, 10, NOW)).toBe('redemption_limit_reached');
  });

  it('redemptionCount below max_redemptions -> still eligible', () => {
    expect(promoEligibility({ ...basePromo, max_redemptions: 10 }, 9, NOW)).toBeNull();
  });

  it('deleted takes priority over inactive/expired', () => {
    expect(promoEligibility({ active: false, deleted_at: '2026-01-01T00:00:00Z', redeemable_until: '2020-01-01T00:00:00Z', max_redemptions: 0 }, 5, NOW)).toBe('deleted');
  });
});

describe('computeBenefitEndsAt', () => {
  it('null duration -> permanent (null end)', () => {
    expect(computeBenefitEndsAt(NOW, null)).toBeNull();
  });

  it('adds N months to the redemption date', () => {
    // Asserts the calendar month/day, not an exact UTC instant: setMonth
    // operates in local time, so a 3-month span that crosses a DST boundary
    // in the test runner's timezone legitimately shifts the UTC offset by an
    // hour — that's correct calendar-month arithmetic, not a bug in it.
    const end = computeBenefitEndsAt(NOW, 3);
    expect(end?.getMonth()).toBe(9); // October, 0-indexed
    expect(end?.getDate()).toBe(28);
  });

  it('handles a 1-month duration', () => {
    const end = computeBenefitEndsAt(NOW, 1);
    expect(end?.getMonth()).toBe(7); // August, 0-indexed
    expect(end?.getDate()).toBe(28);
  });
});

describe('benefitStillActive', () => {
  it('null benefit_ends_at -> always active (permanent)', () => {
    expect(benefitStillActive(null, NOW)).toBe(true);
  });

  it('future end date -> active', () => {
    expect(benefitStillActive('2027-01-01T00:00:00Z', NOW)).toBe(true);
  });

  it('past end date -> not active', () => {
    expect(benefitStillActive('2026-01-01T00:00:00Z', NOW)).toBe(false);
  });
});

describe('discountedPriceEur', () => {
  it('50% off 85 -> 43 (rounds .5 up)', () => {
    expect(discountedPriceEur(85, 50)).toBe(43);
  });

  it('100% off -> 0 (free trial case)', () => {
    expect(discountedPriceEur(149, 100)).toBe(0);
  });

  it('0-ish edge: 1% off rounds sensibly', () => {
    expect(discountedPriceEur(100, 1)).toBe(99);
  });
});

describe('normalizeDiscountForKind', () => {
  it('free_trial always forces 100, regardless of the input value', () => {
    expect(normalizeDiscountForKind('free_trial', 30)).toBe(100);
    expect(normalizeDiscountForKind('free_trial', 100)).toBe(100);
  });

  it('percent_off passes the value through unchanged', () => {
    expect(normalizeDiscountForKind('percent_off', 30)).toBe(30);
  });
});

describe('normalizePromoCodeInput', () => {
  it('trims, uppercases, and strips internal whitespace', () => {
    expect(normalizePromoCodeInput('  launch 50  ')).toBe('LAUNCH50');
  });
});

describe('generatePromoCode', () => {
  it('defaults to 8 characters', () => {
    expect(generatePromoCode()).toHaveLength(8);
  });

  it('respects a custom length', () => {
    expect(generatePromoCode(4)).toHaveLength(4);
  });

  it('never includes ambiguous characters (0/O, 1/I/L)', () => {
    const codes = Array.from({ length: 200 }, () => generatePromoCode(12)).join('');
    expect(codes).not.toMatch(/[01ILO]/);
  });
});
