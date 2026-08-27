import { describe, expect, it } from 'vitest';
import { computeRequiredExit, computeScenarioReturns, computeXirr, type ScenarioOwnership } from './scenario-returns';

describe('computeXirr', () => {
  it('matches the closed-form answer for 2 cash flows', () => {
    // -100 at t=0, +200 at t=2 -> (1+r)^2 = 2 -> r = sqrt(2)-1
    const r = computeXirr([{ yearsFromNow: 0, amountEur: -100 }, { yearsFromNow: 2, amountEur: 200 }]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(Math.sqrt(2) - 1, 6);
  });

  it('solves 3 cash flows (a follow-on) by verifying NPV at the solved rate is ~0', () => {
    const flows = [
      { yearsFromNow: 0, amountEur: -100 },
      { yearsFromNow: 1, amountEur: -50 },
      { yearsFromNow: 3, amountEur: 300 },
    ];
    const r = computeXirr(flows);
    expect(r).not.toBeNull();
    const npvAtSolution = flows.reduce((sum, f) => sum + f.amountEur / Math.pow(1 + r!, f.yearsFromNow), 0);
    expect(npvAtSolution).toBeCloseTo(0, 4);
  });

  it('returns null when every flow is the same sign — no rate of return exists', () => {
    expect(computeXirr([{ yearsFromNow: 0, amountEur: -100 }, { yearsFromNow: 1, amountEur: -50 }])).toBeNull();
    expect(computeXirr([{ yearsFromNow: 0, amountEur: 100 }])).toBeNull();
  });

  it('a simple 100% gain in 1 year is exactly 100% IRR', () => {
    const r = computeXirr([{ yearsFromNow: 0, amountEur: -100 }, { yearsFromNow: 1, amountEur: 200 }]);
    expect(r!).toBeCloseTo(1, 6);
  });
});

function ownership(opts: { ownershipAtExitPct: number; totalCapitalInvestedEur: number; cashOutflows?: { yearsFromNow: number; amountEur: number }[] }): ScenarioOwnership {
  return {
    ownershipAtExitPct: opts.ownershipAtExitPct,
    totalCapitalInvestedEur: opts.totalCapitalInvestedEur,
    cashOutflows: opts.cashOutflows ?? [{ yearsFromNow: 0, amountEur: -opts.totalCapitalInvestedEur }],
  };
}

describe('computeScenarioReturns', () => {
  it('single scenario, no follow-ons: IRR matches the plain CAGR degenerate formula', () => {
    // 2% ownership, 100k invested, exit at 20M in 5 years -> proceeds 400k -> 4x
    const own = ownership({ ownershipAtExitPct: 2, totalCapitalInvestedEur: 100000 });
    const { scenarios } = computeScenarioReturns(
      [{ label: 'Base', probabilityPct: 100, exitValueEur: 20000000, horizonYears: 5 }], own,
    );
    expect(scenarios[0].proceedsEur).toBeCloseTo(400000, 2);
    expect(scenarios[0].moic).toBeCloseTo(4, 6);
    expect(scenarios[0].irr!).toBeCloseTo(Math.pow(4, 1 / 5) - 1, 6);
  });

  it('a Failure scenario (exit=0) has zero proceeds/MOIC and a null IRR, never a crash or a fake 0% IRR', () => {
    const own = ownership({ ownershipAtExitPct: 2, totalCapitalInvestedEur: 100000 });
    const { scenarios } = computeScenarioReturns(
      [{ label: 'Failure', probabilityPct: 100, exitValueEur: 0, horizonYears: 3 }], own,
    );
    expect(scenarios[0].proceedsEur).toBe(0);
    expect(scenarios[0].moic).toBe(0);
    expect(scenarios[0].irr).toBeNull();
  });

  it('weights: probability-weighted MOIC and expected value across 3 named presets summing to 100', () => {
    const own = ownership({ ownershipAtExitPct: 2, totalCapitalInvestedEur: 100000 });
    const { aggregate } = computeScenarioReturns([
      { label: 'Failure', probabilityPct: 20, exitValueEur: 0, horizonYears: 3 },
      { label: 'Base', probabilityPct: 50, exitValueEur: 20000000, horizonYears: 5 }, // 4x
      { label: 'Outlier', probabilityPct: 30, exitValueEur: 50000000, horizonYears: 7 }, // 10x
    ], own);
    expect(aggregate.probabilitiesValid).toBe(true);
    // 0.20*0 + 0.50*4 + 0.30*10 = 2 + 3 = 5
    expect(aggregate.weightedMoic!).toBeCloseTo(5, 6);
    // 0.20*0 + 0.50*400,000 + 0.30*1,000,000 = 200,000 + 300,000 = 500,000
    expect(aggregate.expectedValueEur!).toBeCloseTo(500000, 2);
    // Failure's null IRR means the weighted IRR is unknown, not zero-weighted-in
    expect(aggregate.weightedIrr).toBeNull();
  });

  it('probabilities not summing to 100: every aggregate is null, per-scenario results are untouched', () => {
    const own = ownership({ ownershipAtExitPct: 2, totalCapitalInvestedEur: 100000 });
    const { scenarios, aggregate } = computeScenarioReturns([
      { label: 'Base', probabilityPct: 50, exitValueEur: 20000000, horizonYears: 5 },
      { label: 'Upside', probabilityPct: 30, exitValueEur: 40000000, horizonYears: 5 }, // sums to 80, not 100
    ], own);
    expect(aggregate.probabilitiesSumPct).toBeCloseTo(80, 6);
    expect(aggregate.probabilitiesValid).toBe(false);
    expect(aggregate.weightedMoic).toBeNull();
    expect(aggregate.weightedIrr).toBeNull();
    expect(aggregate.expectedValueEur).toBeNull();
    // the scenarios themselves still computed their own real numbers
    expect(scenarios[0].moic).toBeCloseTo(4, 6);
    expect(scenarios[1].moic).toBeCloseTo(8, 6);
  });

  it('with a dated pro-rata follow-on, IRR is solved via XIRR (not the single-flow CAGR shortcut)', () => {
    const own = ownership({
      ownershipAtExitPct: 2, totalCapitalInvestedEur: 150000,
      cashOutflows: [{ yearsFromNow: 0, amountEur: -100000 }, { yearsFromNow: 1, amountEur: -50000 }],
    });
    const { scenarios } = computeScenarioReturns(
      [{ label: 'Base', probabilityPct: 100, exitValueEur: 20000000, horizonYears: 5 }], own,
    );
    const flows = [...own.cashOutflows, { yearsFromNow: 5, amountEur: scenarios[0].proceedsEur }];
    const npvAtSolution = flows.reduce((sum, f) => sum + f.amountEur / Math.pow(1 + scenarios[0].irr!, f.yearsFromNow), 0);
    expect(npvAtSolution).toBeCloseTo(0, 3);
  });
});

describe('computeRequiredExit (VC Method)', () => {
  it('running the required exit forward through computeScenarioReturns returns exactly the target multiple', () => {
    const own = ownership({ ownershipAtExitPct: 2, totalCapitalInvestedEur: 100000 });
    const requiredExit = computeRequiredExit(10, own);
    expect(requiredExit).not.toBeNull();

    const { scenarios } = computeScenarioReturns(
      [{ label: 'Check', probabilityPct: 100, exitValueEur: requiredExit!, horizonYears: 5 }], own,
    );
    expect(scenarios[0].moic).toBeCloseTo(10, 6);
  });

  it('accounts for follow-on capital already invested, not just the initial ticket', () => {
    const ownNoFollowOn = ownership({ ownershipAtExitPct: 2, totalCapitalInvestedEur: 100000 });
    const ownWithFollowOn = ownership({ ownershipAtExitPct: 2, totalCapitalInvestedEur: 250000 });
    const exitNoFollowOn = computeRequiredExit(10, ownNoFollowOn)!;
    const exitWithFollowOn = computeRequiredExit(10, ownWithFollowOn)!;
    // more capital invested for the same ownership -> needs a bigger exit to hit the same multiple
    expect(exitWithFollowOn).toBeGreaterThan(exitNoFollowOn);
    expect(exitWithFollowOn).toBeCloseTo(exitNoFollowOn * 2.5, 2);
  });

  it('returns null for zero ownership — no finite exit gets you a return on nothing', () => {
    expect(computeRequiredExit(10, ownership({ ownershipAtExitPct: 0, totalCapitalInvestedEur: 100000 }))).toBeNull();
  });
});
