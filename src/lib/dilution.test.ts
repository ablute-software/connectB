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

// Prompt 408 §A.1 — the richer futureRounds path. futureRoundDilutionsPct
// stays covered by the suite above, untouched by any of this.
describe('computeDilution — futureRounds (option pool + pro-rata)', () => {
  const base = { ticketEur: 100000, roundValuationEur: 5000000, roundTargetEur: 1000000, valuationBasis: 'post_money' as const, futureRoundDilutionsPct: [] };

  it('option pool expansion composes multiplicatively with round dilution, not additively', () => {
    const r = computeDilution({ ...base, futureRounds: [{ dilutionPct: 20, optionPoolExpansionPct: 10 }] });
    // 2% * (1-0.20) * (1-0.10) = 2% * 0.8 * 0.9 = 1.44%, NOT 2% * 0.70 = 1.4%
    expect(r.ownershipAfterFutureRoundsPct[0]).toBeCloseTo(1.44, 5);
    expect(r.proRataStatusByRound).toEqual(['not_requested']);
  });

  it('pro-rata participation with a priced round: ownership holds, capital invested grows', () => {
    const r = computeDilution({ ...base, futureRounds: [{ dilutionPct: 20, participateProRata: true, roundValuationEur: 8000000 }] });
    expect(r.ownershipAfterFutureRoundsPct[0]).toBeCloseTo(r.ownershipAfterThisRoundPct, 10); // unchanged
    // proRataCost = 2% * 8,000,000 = 160,000; total = 100,000 ticket + 160,000
    expect(r.totalCapitalInvestedEur).toBeCloseTo(260000, 2);
    expect(r.proRataStatusByRound).toEqual(['applied']);
  });

  it('pro-rata requested without a round valuation: unavailable, falls back to normal dilution', () => {
    const r = computeDilution({ ...base, futureRounds: [{ dilutionPct: 20, participateProRata: true }] });
    expect(r.ownershipAfterFutureRoundsPct[0]).toBeCloseTo(1.6, 5); // 2% * 0.8, same as a plain dilution round
    expect(r.totalCapitalInvestedEur).toBeCloseTo(100000, 2); // no pro-rata cost added
    expect(r.proRataStatusByRound).toEqual(['unavailable_no_valuation']);
  });

  it('mixed rounds: pro-rata (holds), then a plain diluting round with a pool expansion', () => {
    const r = computeDilution({
      ...base,
      futureRounds: [
        { dilutionPct: 20, participateProRata: true, roundValuationEur: 8000000 },
        { dilutionPct: 15, optionPoolExpansionPct: 5 },
      ],
    });
    const afterRound1 = r.ownershipAfterFutureRoundsPct[0];
    expect(afterRound1).toBeCloseTo(2, 5); // held from pro-rata
    const expectedAfterRound2 = afterRound1 * 0.85 * 0.95;
    expect(r.ownershipAfterFutureRoundsPct[1]).toBeCloseTo(expectedAfterRound2, 8);
    expect(r.totalCapitalInvestedEur).toBeCloseTo(260000, 2); // only round 1 added pro-rata cost
    expect(r.proRataStatusByRound).toEqual(['applied', 'not_requested']);
  });

  it('the plain futureRoundDilutionsPct path never sets the new futureRounds-only fields', () => {
    const r = computeDilution({ ...base, futureRoundDilutionsPct: [20] });
    expect(r.totalCapitalInvestedEur).toBeUndefined();
    expect(r.proRataStatusByRound).toBeUndefined();
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
