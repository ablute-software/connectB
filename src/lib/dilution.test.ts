import { describe, expect, it } from 'vitest';
import { computeDilution, deriveValuation } from './dilution';

describe('computeDilution', () => {
  it('computes ownership from a post-money valuation directly', () => {
    const r = computeDilution({
      ticketEur: 100000, roundValuationEur: 5000000, roundTargetEur: 1000000,
      valuationBasis: 'post_money', futureRoundDilutionsPct: [],
    });
    expect(r.postMoneyEur).toBe(5000000);
    expect(r.ownershipAfterThisRoundPct).toBeCloseTo(2, 5);
  });

  it('derives post-money from pre-money + round target', () => {
    const r = computeDilution({
      ticketEur: 100000, roundValuationEur: 4000000, roundTargetEur: 1000000,
      valuationBasis: 'pre_money', futureRoundDilutionsPct: [],
    });
    expect(r.postMoneyEur).toBe(5000000);
    expect(r.ownershipAfterThisRoundPct).toBeCloseTo(2, 5);
  });

  it('applies cumulative dilution across future rounds', () => {
    const r = computeDilution({
      ticketEur: 100000, roundValuationEur: 5000000, roundTargetEur: 1000000,
      valuationBasis: 'post_money', futureRoundDilutionsPct: [20, 15],
    });
    expect(r.ownershipAfterThisRoundPct).toBeCloseTo(2, 5);
    expect(r.ownershipAfterFutureRoundsPct[0]).toBeCloseTo(1.6, 5); // 2% * 0.8
    expect(r.ownershipAfterFutureRoundsPct[1]).toBeCloseTo(1.36, 5); // 1.6% * 0.85
  });

  it('returns zero ownership for a zero/unknown valuation instead of dividing by zero', () => {
    const r = computeDilution({
      ticketEur: 100000, roundValuationEur: 0, roundTargetEur: 0,
      valuationBasis: 'post_money', futureRoundDilutionsPct: [],
    });
    expect(r.ownershipAfterThisRoundPct).toBe(0);
    expect(Number.isFinite(r.ownershipAfterThisRoundPct)).toBe(true);
  });
});

describe('deriveValuation (Prompt 115 Block E)', () => {
  it('derives post-money from a declared pre-money figure — never a destructive conversion of the stored number', () => {
    const d = deriveValuation('pre_money', 5700000, 1300000);
    expect(d.preMoneyEur).toBe(5700000); // unchanged — the number the founder actually typed
    expect(d.postMoneyEur).toBe(7000000);
    expect(d.roundEur).toBe(1300000);
  });

  it('derives pre-money from a declared post-money figure', () => {
    // ablute_'s real numbers (migration 0111's backfill row).
    const d = deriveValuation('post_money', 7000000, 1300000);
    expect(d.postMoneyEur).toBe(7000000); // unchanged
    expect(d.preMoneyEur).toBe(5700000);
    expect(d.roundEur).toBe(1300000);
  });
});
