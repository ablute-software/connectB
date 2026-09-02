import { describe, expect, it } from 'vitest';
import {
  applyDrag, fitMonthlyGrowthPct, minimumMaturityMonths, outreachPlan,
  simulateRunway, solveRaiseForRunway, startMrrFromAnchor,
  type RunwayInputs,
} from './round-blueprint';

function base(over: Partial<RunwayInputs> = {}): RunwayInputs {
  return {
    startingCashEur: 0,
    raise: { totalEur: 0, tranches: [] },
    burn: { startEur: 10_000, steps: [] },
    revenue: { startMrrEur: 0, monthlyGrowthPct: 0, grossMarginPct: 0 },
    horizonMonths: 36,
    seedLeadMonths: 6,
    ...over,
  };
}

describe('simulateRunway', () => {
  // runwayEndMonth is the first month that ENDS below zero, so the number of
  // survivable months is one less. Asserted explicitly because that off-by-one
  // is the kind of thing a chart marker gets silently wrong.
  it('flat burn, no revenue: months of runway = floor(cash / burn)', () => {
    const { markers } = simulateRunway(base({ startingCashEur: 120_000, burn: { startEur: 10_000, steps: [] } }));
    expect(markers.runwayEndMonth).toBe(13);
    expect((markers.runwayEndMonth as number) - 1).toBe(Math.floor(120_000 / 10_000));
  });

  it('handles a non-integer ratio the same way', () => {
    const { markers } = simulateRunway(base({ startingCashEur: 125_000, burn: { startEur: 10_000, steps: [] } }));
    expect((markers.runwayEndMonth as number) - 1).toBe(Math.floor(125_000 / 10_000));
  });

  it('month 0 is the opening position and carries the tranches that land now', () => {
    const { points } = simulateRunway(base({
      startingCashEur: 50_000,
      raise: { totalEur: 400_000, tranches: [{ month: 0, eur: 400_000 }] },
    }));
    expect(points[0].month).toBe(0);
    expect(points[0].cashIn).toBe(400_000);
    expect(points[0].cashEnd).toBe(450_000);
    expect(points[0].burn).toBe(0);
  });

  it('a tranche arriving before runway end extends it', () => {
    const withoutTranche = simulateRunway(base({ startingCashEur: 120_000 }));
    const withTranche = simulateRunway(base({
      startingCashEur: 120_000,
      raise: { totalEur: 100_000, tranches: [{ month: 7, eur: 100_000 }] },
    }));
    expect(withoutTranche.markers.runwayEndMonth).toBe(13);
    expect(withTranche.markers.runwayEndMonth).toBe(23);
  });

  it('a tranche arriving after the money runs out does not rescue the gap', () => {
    const { markers, points } = simulateRunway(base({
      startingCashEur: 120_000,
      raise: { totalEur: 100_000, tranches: [{ month: 20, eur: 100_000 }] },
    }));
    // Still goes negative at 13; the later money just brings it back up.
    expect(markers.runwayEndMonth).toBe(13);
    expect(points.find((p) => p.month === 21)?.cashEnd).toBeGreaterThan(0);
  });

  it('burn steps apply from their month onward', () => {
    const { points } = simulateRunway(base({
      startingCashEur: 1_000_000,
      burn: { startEur: 10_000, steps: [{ month: 5, eur: 25_000, label: 'two hires' }] },
    }));
    expect(points.find((p) => p.month === 4)?.burn).toBe(10_000);
    expect(points.find((p) => p.month === 5)?.burn).toBe(25_000);
    expect(points.find((p) => p.month === 12)?.burn).toBe(25_000);
  });

  it('revenue compounds from month 1 and gross margin decides what reaches cash', () => {
    const { points } = simulateRunway(base({
      startingCashEur: 100_000,
      revenue: { startMrrEur: 1_000, monthlyGrowthPct: 10, grossMarginPct: 50 },
    }));
    expect(points.find((p) => p.month === 1)?.revenue).toBeCloseTo(1_000, 6);
    expect(points.find((p) => p.month === 3)?.revenue).toBeCloseTo(1_210, 6);
    expect(points.find((p) => p.month === 3)?.grossProfit).toBeCloseTo(605, 6);
  });

  it('break-even is the first month gross profit covers burn, and null when it never does', () => {
    const reaches = simulateRunway(base({
      startingCashEur: 500_000,
      burn: { startEur: 10_000, steps: [] },
      revenue: { startMrrEur: 5_000, monthlyGrowthPct: 10, grossMarginPct: 100 },
    }));
    expect(reaches.markers.breakEvenMonth).toBe(9);
    expect(simulateRunway(base({ startingCashEur: 500_000 })).markers.breakEvenMonth).toBeNull();
  });

  it('start-raising is seedLead months before the end, never below month 1', () => {
    expect(simulateRunway(base({ startingCashEur: 120_000 })).markers.startRaisingMonth).toBe(7);
    // Runs out almost immediately: the honest answer is "now", not month -3.
    expect(simulateRunway(base({ startingCashEur: 5_000 })).markers.startRaisingMonth).toBe(1);
  });

  it('reports null runway end when the plan survives the whole horizon', () => {
    const { markers } = simulateRunway(base({ startingCashEur: 10_000_000 }));
    expect(markers.runwayEndMonth).toBeNull();
    expect(markers.startRaisingMonth).toBeNull();
  });

  it('shows the trough a delayed tranche digs before it lands', () => {
    const { points, markers } = simulateRunway(base({
      startingCashEur: 0,
      burn: { startEur: 20_000, steps: [] },
      horizonMonths: 20,
      raise: { totalEur: 400_000, tranches: [{ month: 0, eur: 150_000 }, { month: 7, eur: 250_000 }] },
    }));
    // Month 6 is the local trough — the last month before the second close,
    // and the number that decides whether a staged round is survivable.
    expect(points[6].cashEnd).toBeCloseTo(30_000, 6);
    expect(points[6].cashEnd).toBeLessThan(points[5].cashEnd);
    expect(points[7].cashEnd).toBeGreaterThan(points[6].cashEnd);
    // The marker itself reports the global minimum, which on a plan spending
    // its last euro in the final month is that final month, not the trough.
    expect(markers.minCashMonth).toBe(20);
    expect(markers.minCashEur).toBeCloseTo(0, 6);
  });
});

describe('solveRaiseForRunway', () => {
  it('round-trips: the solved raise actually buys the runway asked for', () => {
    const inputs = base({ startingCashEur: 0, burn: { startEur: 20_000, steps: [] } });
    const raise = solveRaiseForRunway(inputs, 18);
    const { points } = simulateRunway({ ...inputs, raise: { totalEur: raise, tranches: [{ month: 0, eur: raise }] } });
    for (const p of points.filter((x) => x.month > 0 && x.month <= 18)) expect(p.cashEnd).toBeGreaterThanOrEqual(0);
    expect(raise).toBeCloseTo(360_000, 0);
  });

  it('accounts for revenue, so it asks for less than burn alone would suggest', () => {
    const withRevenue = base({
      burn: { startEur: 20_000, steps: [] },
      revenue: { startMrrEur: 4_000, monthlyGrowthPct: 8, grossMarginPct: 75 },
    });
    expect(solveRaiseForRunway(withRevenue, 18)).toBeLessThan(solveRaiseForRunway(base({ burn: { startEur: 20_000, steps: [] } }), 18));
  });

  it('keeps the tranche shape when scaling an existing plan', () => {
    const inputs = base({
      burn: { startEur: 20_000, steps: [] },
      raise: { totalEur: 200_000, tranches: [{ month: 0, eur: 150_000 }, { month: 7, eur: 50_000 }] },
    });
    const raise = solveRaiseForRunway(inputs, 24);
    const { points } = simulateRunway({
      ...inputs,
      raise: { totalEur: raise, tranches: [{ month: 0, eur: raise * 0.75 }, { month: 7, eur: raise * 0.25 }] },
    });
    for (const p of points.filter((x) => x.month > 0 && x.month <= 24)) expect(p.cashEnd).toBeGreaterThanOrEqual(0);
  });

  it('asks for nothing when the plan already survives', () => {
    expect(solveRaiseForRunway(base({ startingCashEur: 1_000_000 }), 18)).toBe(0);
  });
});

describe('applyDrag', () => {
  const inputs = base({
    startingCashEur: 0,
    burn: { startEur: 20_000, steps: [] },
    raise: { totalEur: 300_000, tranches: [{ month: 0, eur: 300_000 }] },
  });

  it('cash: moves the raise only, and reproduces the dragged value at that month', () => {
    const next = applyDrag(inputs, 'cash', 10, 250_000);
    expect(simulateRunway(next).points.find((p) => p.month === 10)?.cashEnd).toBeCloseTo(250_000, 6);
    // Exactly one lever moved.
    expect(next.burn).toEqual(inputs.burn);
    expect(next.revenue).toEqual(inputs.revenue);
    expect(next.raise.totalEur).toBeCloseTo(450_000, 6);
  });

  it('cash: applies to the latest tranche at or before the dragged month', () => {
    const twoTranche = base({
      burn: { startEur: 20_000, steps: [] },
      raise: { totalEur: 400_000, tranches: [{ month: 0, eur: 150_000 }, { month: 7, eur: 250_000 }] },
    });
    const next = applyDrag(twoTranche, 'cash', 10, 300_000);
    expect(next.raise.tranches[0].eur).toBe(150_000);       // untouched
    expect(next.raise.tranches[1].eur).not.toBe(250_000);   // the one that could affect month 10
    expect(simulateRunway(next).points.find((p) => p.month === 10)?.cashEnd).toBeCloseTo(300_000, 6);
  });

  it('burn: writes a step at that month and leaves raise and revenue alone', () => {
    const next = applyDrag(inputs, 'burn', 6, 35_000);
    expect(simulateRunway(next).points.find((p) => p.month === 6)?.burn).toBe(35_000);
    expect(simulateRunway(next).points.find((p) => p.month === 5)?.burn).toBe(20_000);
    expect(next.raise).toEqual(inputs.raise);
    expect(next.revenue).toEqual(inputs.revenue);
  });

  it('burn: replaces an existing step at the same month rather than stacking one', () => {
    const once = applyDrag(inputs, 'burn', 6, 35_000);
    const twice = applyDrag(once, 'burn', 6, 40_000);
    expect(twice.burn.steps.filter((s) => s.month === 6)).toHaveLength(1);
    expect(simulateRunway(twice).points.find((p) => p.month === 6)?.burn).toBe(40_000);
  });

  it('revenue: solves growth so the dragged month hits the value', () => {
    const withRevenue = { ...inputs, revenue: { startMrrEur: 1_000, monthlyGrowthPct: 5, grossMarginPct: 70 } };
    const next = applyDrag(withRevenue, 'revenue', 12, 8_000);
    expect(simulateRunway(next).points.find((p) => p.month === 12)?.revenue).toBeCloseTo(8_000, 6);
    expect(next.raise).toEqual(withRevenue.raise);
    expect(next.burn).toEqual(withRevenue.burn);
  });

  it('revenue: month 1 moves the starting MRR, because growth has not applied yet', () => {
    const withRevenue = { ...inputs, revenue: { startMrrEur: 1_000, monthlyGrowthPct: 5, grossMarginPct: 70 } };
    const next = applyDrag(withRevenue, 'revenue', 1, 2_500);
    expect(next.revenue.startMrrEur).toBe(2_500);
    expect(next.revenue.monthlyGrowthPct).toBe(5);
  });
});

describe('outreachPlan', () => {
  it('matches the worked example in the brief', () => {
    expect(outreachPlan(400_000, 25_000, 20)).toEqual({
      ticketsNeeded: 16, conversationsNeeded: 80, weeksOfOutreach: 4,
    });
  });

  it('rounds up at every step — an outreach estimate must never flatter the plan', () => {
    // 410k/25k = 16.4 -> 17 tickets; 17/0.2 = 85 conversations; 85/20 = 4.25 -> 5 weeks.
    expect(outreachPlan(410_000, 25_000, 20)).toEqual({
      ticketsNeeded: 17, conversationsNeeded: 85, weeksOfOutreach: 5,
    });
  });

  it('a lower yes-rate costs proportionally more conversations', () => {
    expect(outreachPlan(400_000, 25_000, 20, 10).conversationsNeeded).toBe(160);
  });

  it('returns zeros rather than Infinity on empty inputs', () => {
    expect(outreachPlan(0, 25_000, 20)).toEqual({ ticketsNeeded: 0, conversationsNeeded: 0, weeksOfOutreach: 0 });
    expect(outreachPlan(400_000, 0, 20).ticketsNeeded).toBe(0);
    expect(outreachPlan(400_000, 25_000, 0).weeksOfOutreach).toBe(0);
  });
});

describe('revenue anchor helpers', () => {
  it('fits a growth rate through two anchors and reproduces them', () => {
    const g = fitMonthlyGrowthPct({ month: 6, mrrEur: 1_591.67 }, { month: 24, mrrEur: 23_416.67 }) as number;
    const startMrr = startMrrFromAnchor({ month: 6, mrrEur: 1_591.67 }, g) as number;
    const { points } = simulateRunway(base({
      startingCashEur: 1_000_000,
      revenue: { startMrrEur: startMrr, monthlyGrowthPct: g, grossMarginPct: 72 },
    }));
    expect(points.find((p) => p.month === 6)?.revenue).toBeCloseTo(1_591.67, 2);
    expect(points.find((p) => p.month === 24)?.revenue).toBeCloseTo(23_416.67, 2);
  });

  it('refuses to invent a curve from unusable anchors', () => {
    expect(fitMonthlyGrowthPct({ month: 6, mrrEur: 0 }, { month: 24, mrrEur: 100 })).toBeNull();
    expect(fitMonthlyGrowthPct({ month: 24, mrrEur: 100 }, { month: 6, mrrEur: 200 })).toBeNull();
    expect(startMrrFromAnchor({ month: 6, mrrEur: 0 }, 10)).toBeNull();
  });
});

describe('minimumMaturityMonths', () => {
  it('is runway plus the buffer, so a note cannot mature before a round exists', () => {
    const { markers } = simulateRunway(base({ startingCashEur: 120_000 }));
    expect(minimumMaturityMonths(markers, 36)).toBe(19);
  });

  it('falls back to the horizon when the plan never runs out', () => {
    const { markers } = simulateRunway(base({ startingCashEur: 10_000_000 }));
    expect(minimumMaturityMonths(markers, 36)).toBe(42);
  });
});

// The acceptance case from the brief: the Sherlock Deal account's own seed plan.
// The markers go in the report, so they are asserted here rather than eyeballed
// — and asserting them is what surfaced two places where the brief's own
// expected values do not follow from the brief's own inputs. See the report;
// the numbers below are what these inputs actually produce.
describe('dogfood — Sherlock Deal seed plan', () => {
  // Fitted through the m6 and m24 ARR anchors. That pair is the one the brief's
  // own cross-check confirms: it yields €64.2K of revenue across 18 months,
  // matching the brief's "revenue contributes ~€64K". The m12 anchor (ARR
  // €84.5K) does NOT lie on this curve — it implies €46.8K — so the three
  // anchors cannot all sit on a single exponential. Flagged, not silently
  // averaged away.
  const growth = fitMonthlyGrowthPct({ month: 6, mrrEur: 19_100 / 12 }, { month: 24, mrrEur: 281_000 / 12 }) as number;
  const startMrr = startMrrFromAnchor({ month: 6, mrrEur: 19_100 / 12 }, growth) as number;

  const plan = (tranches: { month: number; eur: number }[]): RunwayInputs => ({
    startingCashEur: 0,
    raise: { totalEur: tranches.reduce((s, t) => s + t.eur, 0), tranches },
    burn: { startEur: 22_222, steps: [] },
    revenue: { startMrrEur: startMrr, monthlyGrowthPct: growth, grossMarginPct: 72 },
    horizonMonths: 36,
    seedLeadMonths: 6,
  });

  it('reproduces the two anchors it was fitted through', () => {
    const { points } = simulateRunway(plan([{ month: 0, eur: 400_000 }]));
    expect((points[6].revenue * 12)).toBeCloseTo(19_100, 0);
    expect((points[24].revenue * 12)).toBeCloseTo(281_000, 0);
    expect(growth).toBeCloseTo(16.11, 2);
  });

  it('single €400K tranche: runway ends month 22 — revenue buys 3 months past the cash-only 19', () => {
    const withRevenue = simulateRunway(plan([{ month: 0, eur: 400_000 }]));
    const cashOnly = simulateRunway({
      ...plan([{ month: 0, eur: 400_000 }]),
      revenue: { startMrrEur: 0, monthlyGrowthPct: 0, grossMarginPct: 72 },
    });
    // €400K at €22,222/month is exactly 18 months of burn, so with no revenue
    // month 19 is the first that ends short — the brief's "≈18–19".
    expect(cashOnly.markers.runwayEndMonth).toBe(19);
    // The brief's own revenue assumption then extends it, which its expected
    // marker did not carry through.
    expect(withRevenue.markers.runwayEndMonth).toBe(22);
    expect(withRevenue.markers.startRaisingMonth).toBe(16);
    expect(withRevenue.markers.breakEvenMonth).toBe(26);
  });

  it('revenue over the first 18 months matches the brief\'s ~€64K cross-check', () => {
    const { points } = simulateRunway(plan([{ month: 0, eur: 400_000 }]));
    const revenue18 = points.filter((p) => p.month >= 1 && p.month <= 18).reduce((a, p) => a + p.revenue, 0);
    const grossProfit18 = points.filter((p) => p.month >= 1 && p.month <= 18).reduce((a, p) => a + p.grossProfit, 0);
    expect(revenue18).toBeCloseTo(64_194, 0);
    expect(grossProfit18).toBeCloseTo(46_220, 0);
  });

  it('two tranches (150K m0 + 250K m7): the same runway, bought with a real cash dip', () => {
    const single = simulateRunway(plan([{ month: 0, eur: 400_000 }]));
    const split = simulateRunway(plan([{ month: 0, eur: 150_000 }, { month: 7, eur: 250_000 }]));

    // Same end date — the money all arrives before it would have run out.
    expect(split.markers.runwayEndMonth).toBe(single.markers.runwayEndMonth);

    // The dip is a LOCAL trough at month 6, not a global minimum: once the
    // second tranche lands at month 7 both plans hold the same €400K and their
    // curves coincide from there on, so the lowest point over the whole solvent
    // stretch is identical for both (month 21). What differs — and what the
    // founder needs to see before agreeing to a second close — is how thin it
    // gets while waiting: €21.6K against €271.6K — one slipped month from zero.
    expect(split.points[6].cashEnd).toBeCloseTo(21_557, 0);
    expect(single.points[6].cashEnd).toBeCloseTo(271_557, 0);
    for (let m = 7; m <= 21; m++) expect(split.points[m].cashEnd).toBeCloseTo(single.points[m].cashEnd, 6);
  });

  it('the round is 16 tickets and about a month of outreach at the 20/week cap', () => {
    expect(outreachPlan(400_000, 25_000, 20)).toEqual({ ticketsNeeded: 16, conversationsNeeded: 80, weeksOfOutreach: 4 });
  });
});
