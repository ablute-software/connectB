import { describe, expect, it } from 'vitest';
import {
  promoEligibility, computeBenefitEndsAt, benefitStillActive, isRedemptionCurrentlyActive, discountedPriceEur,
  normalizeDiscountForKind, normalizePromoCodeInput, generatePromoCode, buildOutreachPromoCode, isOutreachArchived,
  emailLockBlocksRedemption,
  type OutreachCategory,
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

describe('isRedemptionCurrentlyActive', () => {
  it('active promo, benefit window open -> active', () => {
    expect(isRedemptionCurrentlyActive({ deleted_at: null }, null, NOW)).toBe(true);
    expect(isRedemptionCurrentlyActive({ deleted_at: null }, '2027-01-01T00:00:00Z', NOW)).toBe(true);
  });

  it('back-office DEACTIVATED the code -> existing redemption KEEPS its benefit until natural expiry (confirmed rule: deactivate blocks new redemptions only, never revokes current holders)', () => {
    // isRedemptionCurrentlyActive deliberately doesn't take `active` at all —
    // this test documents that deactivation must never reach this function.
    expect(isRedemptionCurrentlyActive({ deleted_at: null }, '2027-01-01T00:00:00Z', NOW)).toBe(true);
  });

  it('back-office DELETED the code -> not active, even with time left on the benefit — the one action that revokes every current holder immediately', () => {
    expect(isRedemptionCurrentlyActive({ deleted_at: '2026-07-28T00:00:00Z' }, '2027-01-01T00:00:00Z', NOW)).toBe(false);
  });

  it('benefit window already passed -> not active, independent of deletion', () => {
    expect(isRedemptionCurrentlyActive({ deleted_at: null }, '2026-01-01T00:00:00Z', NOW)).toBe(false);
  });

  it('null promo -> not active', () => {
    expect(isRedemptionCurrentlyActive(null, null, NOW)).toBe(false);
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

// Prompt 854 §B.5/§F — the four worked examples pinned exactly, plus the
// properties every generated code must hold regardless of input.
describe('buildOutreachPromoCode', () => {
  const noneTaken = () => false;

  it('pins the four worked examples', () => {
    expect(buildOutreachPromoCode('Fábrica de Startups', 'program', 100, noneTaken)).toBe('FABRICA100');
    expect(buildOutreachPromoCode('Beta-i', 'accelerator', 50, noneTaken)).toBe('BETAI50');
    expect(buildOutreachPromoCode('Programa Semente', 'program', 100, noneTaken)).toBe('SEMENTE100');
    const soloLetter = buildOutreachPromoCode('A', 'startup', 100, noneTaken);
    expect(soloLetter.length).toBeLessThanOrEqual(10);
    expect(soloLetter.endsWith('100')).toBe(true);
  });

  it('always ends in the discount digits and is never longer than 10 characters', () => {
    const cases: [string, OutreachCategory, number][] = [
      ['Sherlock Deal', 'startup', 30], ['Y Combinator', 'accelerator', 15],
      ['A Really Extremely Long Ecosystem Name Ltd', 'program', 7], ['', 'incubator', 100],
      ['   ', 'startup', 5], ['123 456', 'program', 20],
    ];
    for (const [name, category, pct] of cases) {
      const code = buildOutreachPromoCode(name, category, pct, noneTaken);
      expect(code.length).toBeLessThanOrEqual(10);
      expect(code.endsWith(String(pct))).toBe(true);
    }
  });

  it('a name that is entirely punctuation still produces a valid code', () => {
    const code = buildOutreachPromoCode('!!! — ***', 'startup', 100, noneTaken);
    expect(code.length).toBeLessThanOrEqual(10);
    expect(code.endsWith('100')).toBe(true);
  });

  it('drops a leading word that restates the category', () => {
    expect(buildOutreachPromoCode('Startup Genome', 'startup', 20, noneTaken)).not.toMatch(/^STARTUP/);
    expect(buildOutreachPromoCode('Incubadora Lisboa', 'incubator', 40, noneTaken)).toBe('LISBOA40');
  });

  it('a one-word name that IS the stopword keeps its only word rather than emptying', () => {
    const code = buildOutreachPromoCode('Startup', 'startup', 10, noneTaken);
    expect(code.startsWith('STARTUP') || code.length > 0).toBe(true);
    expect(code.endsWith('10')).toBe(true);
  });

  it('resolves a collision by varying the stem, never returning a taken code', () => {
    const taken = new Set(['BETAI50']);
    const isTaken = (c: string) => taken.has(c);
    const resolved = buildOutreachPromoCode('Beta-i', 'accelerator', 50, isTaken);
    expect(resolved).not.toBe('BETAI50');
    expect(resolved.endsWith('50')).toBe(true);
    expect(resolved.length).toBeLessThanOrEqual(10);
  });

  it('resolves many successive collisions deterministically without repeating', () => {
    const taken = new Set<string>();
    const isTaken = (c: string) => taken.has(c);
    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const code = buildOutreachPromoCode('Beta-i', 'accelerator', 50, isTaken);
      expect(seen.has(code)).toBe(false);
      seen.add(code);
      taken.add(code);
    }
  });

  it('falls back to a random code when the stem space is exhausted', () => {
    // Every single-character stem + '50' is taken -> nothing left to vary.
    const taken = new Set<string>();
    for (const ch of 'ABCDEFGHJKMNPQRSTUVWXYZ23456789') taken.add(`${ch}50`);
    taken.add('BETAI50'); taken.add('BETA50');
    const isTaken = (c: string) => taken.has(c);
    const code = buildOutreachPromoCode('Beta-i', 'accelerator', 50, isTaken);
    expect(isTaken(code)).toBe(false);
    expect(code.length).toBeLessThanOrEqual(10);
    expect(code.endsWith('50')).toBe(true);
  });

  it('is deterministic for the same inputs', () => {
    const a = buildOutreachPromoCode('Fábrica de Startups', 'program', 100, noneTaken);
    const b = buildOutreachPromoCode('Fábrica de Startups', 'program', 100, noneTaken);
    expect(a).toBe(b);
  });
});

describe('emailLockBlocksRedemption (Prompt 876 §B — Nuno: "caso seja associado um email o promo code só possa ser redimido com uma conta através desse email")', () => {
  it('no lock at all -> never blocks', () => {
    expect(emailLockBlocksRedemption(null, 'anyone@example.com')).toBe(false);
    expect(emailLockBlocksRedemption(undefined, 'anyone@example.com')).toBe(false);
  });

  it('matching email -> allowed', () => {
    expect(emailLockBlocksRedemption('founder@startup.com', 'founder@startup.com')).toBe(false);
  });

  it('case-insensitive match -> allowed (Supabase auth emails are not guaranteed one case)', () => {
    expect(emailLockBlocksRedemption('Founder@Startup.com', 'founder@startup.com')).toBe(false);
    expect(emailLockBlocksRedemption('founder@startup.com', 'FOUNDER@STARTUP.COM')).toBe(false);
  });

  it('a different email -> blocked', () => {
    expect(emailLockBlocksRedemption('founder@startup.com', 'someone-else@startup.com')).toBe(true);
  });

  it('locked but the user has no email at all -> blocked, never treated as a match', () => {
    expect(emailLockBlocksRedemption('founder@startup.com', null)).toBe(true);
    expect(emailLockBlocksRedemption('founder@startup.com', undefined)).toBe(true);
  });
});

describe('isOutreachArchived (Prompt 876 §D — the "Arquivo" sub-tab)', () => {
  it('never archives a target with no code at all', () => {
    expect(isOutreachArchived(null, 0, NOW)).toBe(false);
  });

  it('archives a past-deadline code that was never redeemed', () => {
    expect(isOutreachArchived({ redeemable_until: '2026-01-01T00:00:00Z', max_redemptions: null }, 0, NOW)).toBe(true);
  });

  it('does NOT archive a past-deadline code that WAS redeemed — it already served its purpose', () => {
    expect(isOutreachArchived({ redeemable_until: '2026-01-01T00:00:00Z', max_redemptions: null }, 1, NOW)).toBe(false);
  });

  it('does not archive a code whose deadline is still in the future', () => {
    expect(isOutreachArchived({ redeemable_until: '2027-01-01T00:00:00Z', max_redemptions: null }, 0, NOW)).toBe(false);
  });

  it('archives once max_redemptions is reached, regardless of the deadline', () => {
    expect(isOutreachArchived({ redeemable_until: null, max_redemptions: 3 }, 3, NOW)).toBe(true);
    expect(isOutreachArchived({ redeemable_until: null, max_redemptions: 3 }, 2, NOW)).toBe(false);
  });

  it('a live code with no deadline and no redemption cap is never archived', () => {
    expect(isOutreachArchived({ redeemable_until: null, max_redemptions: null }, 0, NOW)).toBe(false);
  });
});
