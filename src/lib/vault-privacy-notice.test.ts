import { describe, expect, it } from 'vitest';
import { addMonthsUtc, isVaultPrivacyNoticeDue } from './vault-privacy-notice';

const T0 = new Date('2026-01-15T00:00:00.000Z');
const day = (n: number) => new Date(T0.getTime() + n * 86_400_000);

describe('isVaultPrivacyNoticeDue', () => {
  it('is due when never shown at all (brand new user)', () => {
    expect(isVaultPrivacyNoticeDue(null, null, T0)).toBe(true);
  });

  it('is due on the very first visit, before any acknowledgement', () => {
    expect(isVaultPrivacyNoticeDue(T0, null, T0)).toBe(true);
  });

  it('is not due again the same day it was acknowledged', () => {
    expect(isVaultPrivacyNoticeDue(T0, T0, day(0.2))).toBe(false);
  });

  it('is not due the day before the 2-month mark', () => {
    const twoMonths = addMonthsUtc(T0, 2);
    const justBefore = new Date(twoMonths.getTime() - 86_400_000);
    expect(isVaultPrivacyNoticeDue(T0, T0, justBefore)).toBe(false);
  });

  it('is due exactly at the 2-month mark', () => {
    const twoMonths = addMonthsUtc(T0, 2);
    expect(isVaultPrivacyNoticeDue(T0, T0, twoMonths)).toBe(true);
  });

  it('is due exactly at the 4-month mark, after the 2-month mark was already acknowledged', () => {
    const twoMonths = addMonthsUtc(T0, 2);
    const fourMonths = addMonthsUtc(T0, 4);
    expect(isVaultPrivacyNoticeDue(T0, twoMonths, fourMonths)).toBe(true);
  });

  it('settles into a 4-month cadence past the 4-month mark (not due mid-interval)', () => {
    const fourMonths = addMonthsUtc(T0, 4);
    const sixMonths = addMonthsUtc(T0, 6);
    expect(isVaultPrivacyNoticeDue(T0, fourMonths, sixMonths)).toBe(false);
  });

  it('is due again at the next 4-month boundary after that (8 months from T0)', () => {
    const fourMonths = addMonthsUtc(T0, 4);
    const eightMonths = addMonthsUtc(T0, 8);
    expect(isVaultPrivacyNoticeDue(T0, fourMonths, eightMonths)).toBe(true);
  });

  it('keeps recurring indefinitely (12, 16, 20 months out)', () => {
    const eightMonths = addMonthsUtc(T0, 8);
    const twelveMonths = addMonthsUtc(T0, 12);
    const sixteenMonths = addMonthsUtc(T0, 16);
    expect(isVaultPrivacyNoticeDue(T0, eightMonths, twelveMonths)).toBe(true);
    expect(isVaultPrivacyNoticeDue(T0, twelveMonths, sixteenMonths)).toBe(true);
    expect(isVaultPrivacyNoticeDue(T0, sixteenMonths, addMonthsUtc(T0, 17))).toBe(false);
  });

  it('is not fooled by an old acknowledgement once a boundary has been crossed since', () => {
    // Acknowledged right at the 4-month mark, then 5 months pass without a
    // fresh visit — by then the next (8-month) boundary is also behind us.
    const fourMonths = addMonthsUtc(T0, 4);
    const nineMonths = addMonthsUtc(T0, 9);
    expect(isVaultPrivacyNoticeDue(T0, fourMonths, nineMonths)).toBe(true);
  });
});
