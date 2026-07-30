import { describe, expect, it } from 'vitest';
import { computeDilution } from './dilution';

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
