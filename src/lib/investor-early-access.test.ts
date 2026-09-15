import { describe, expect, it } from 'vitest';
import { earlyAccessEndsAt, isNearEarlyAccessEnd } from './investor-early-access';

describe('earlyAccessEndsAt', () => {
  it('adds one calendar month', () => {
    expect(earlyAccessEndsAt(new Date('2026-09-14T10:00:00Z')).toISOString()).toBe('2026-10-14T10:00:00.000Z');
  });

  it('handles a month-end start date via JS Date rollover (documented, not a special case)', () => {
    // Jan 31 + 1 month -> setMonth(1) on a 31st rolls into March on a
    // non-leap year (Feb has no 31st) — native JS Date behaviour, not
    // something this function special-cases. Worth a named test so a
    // future change to this function has to notice it, not silently
    // start giving a different answer for the rare month-end signup.
    expect(earlyAccessEndsAt(new Date('2026-01-31T00:00:00Z')).toISOString()).toBe('2026-03-03T00:00:00.000Z');
  });
});

describe('isNearEarlyAccessEnd', () => {
  const start = new Date('2026-09-01T00:00:00Z'); // ends 2026-10-01

  it('false well before the end', () => {
    expect(isNearEarlyAccessEnd(start, new Date('2026-09-15T00:00:00Z'))).toBe(false);
  });

  it('true inside the 7-day warning window', () => {
    expect(isNearEarlyAccessEnd(start, new Date('2026-09-25T00:00:00Z'))).toBe(true);
    expect(isNearEarlyAccessEnd(start, new Date('2026-09-30T23:00:00Z'))).toBe(true);
  });

  it('false once the end date has passed — this prompt does not build the block, only the warning', () => {
    expect(isNearEarlyAccessEnd(start, new Date('2026-10-01T00:00:00Z'))).toBe(false);
    expect(isNearEarlyAccessEnd(start, new Date('2026-10-05T00:00:00Z'))).toBe(false);
  });

  it('warnDays is configurable', () => {
    expect(isNearEarlyAccessEnd(start, new Date('2026-09-20T00:00:00Z'), 14)).toBe(true);
    expect(isNearEarlyAccessEnd(start, new Date('2026-09-20T00:00:00Z'), 7)).toBe(false);
  });
});
