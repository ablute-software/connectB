// Prompt 408 §A.2 — Scenarios & returns math engine. Pure functions, no I/O
// (same discipline as dilution.ts/rules.ts): given an ownership/capital
// profile (from dilution.ts's computeDilution, richer futureRounds path)
// and a set of named exit scenarios, compute per-scenario proceeds/MOIC/IRR
// and probability-weighted aggregates — plus the VC Method's own inversion,
// required exit for a target multiple.
//
// "Princípios" from the prompt's own header, applied throughout this file:
// unknown never becomes an average value (a scenario whose IRR can't be
// solved, or an invalid probability sum, nulls out the AGGREGATE that
// depends on it rather than silently substituting zero or excluding it);
// every output that depends on probabilities refuses to compute in silence
// when they don't sum to 100.

export interface CashFlow { yearsFromNow: number; amountEur: number }

function npv(rate: number, flows: CashFlow[]): number {
  return flows.reduce((sum, f) => sum + f.amountEur / Math.pow(1 + rate, f.yearsFromNow), 0);
}

function npvDerivative(rate: number, flows: CashFlow[]): number {
  return flows.reduce((sum, f) => sum - (f.yearsFromNow * f.amountEur) / Math.pow(1 + rate, f.yearsFromNow + 1), 0);
}

// Small, pure XIRR: Newton-Raphson first (fast, exact when it converges),
// bisection as a fallback over a wide bracket (robust when Newton
// oscillates or hits a near-zero derivative — both real possibilities with
// only 2-4 cash flows and no guarantee they're well-behaved).
//
// Prompt 409 — total loss (capital went out, nothing ever came back) is a
// DEFINED rate by financial convention, IRR = −100%, not an unknown one:
// returning null here made Failure (exit=0 — the standard First Chicago
// setup, not an edge case) silently erase the weighted IRR every time it
// was present, which is backwards — a 20% chance of losing everything
// should pull the expected IRR down, not make it "n/a". null is reserved
// for the genuinely rateless cases: never invested at all (every flow the
// same sign, positive — hasNeg false), or real non-convergence.
export function computeXirr(flows: CashFlow[]): number | null {
  const hasNeg = flows.some((f) => f.amountEur < 0);
  const hasPos = flows.some((f) => f.amountEur > 0);
  if (!hasNeg) return null; // nothing was ever invested — no rate to speak of
  if (!hasPos) return -1; // invested, got back exactly nothing — IRR = -100%

  let rate = 0.2;
  for (let i = 0; i < 100; i++) {
    const value = npv(rate, flows);
    const deriv = npvDerivative(rate, flows);
    if (Math.abs(deriv) < 1e-10) break;
    const next = rate - value / deriv;
    if (!Number.isFinite(next) || next <= -0.999999) break;
    if (Math.abs(next - rate) < 1e-9) return next;
    rate = next;
  }

  let lo = -0.999999;
  let hi = 10;
  let fLo = npv(lo, flows);
  let fHi = npv(hi, flows);
  if (Math.sign(fLo) === Math.sign(fHi)) {
    hi = 1000;
    fHi = npv(hi, flows);
    if (Math.sign(fLo) === Math.sign(fHi)) return null; // no sign change in a plausible range — no solvable root
  }
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, flows);
    if (Math.abs(fMid) < 1e-9) return mid;
    if (Math.sign(fMid) === Math.sign(fLo)) { lo = mid; fLo = fMid; } else { hi = mid; }
  }
  return (lo + hi) / 2;
}

// The ownership/capital profile shared by every scenario — computed once
// (dilution.ts's computeDilution, futureRounds path), not per-scenario:
// 408 §A.3's own UI spec has ticket/basis/dilution/pro-rata as ONE shared
// state block, scenarios varying only by probability/exit/horizon.
export interface ScenarioOwnership {
  ownershipAtExitPct: number;
  totalCapitalInvestedEur: number;
  // The dated capital calls behind totalCapitalInvestedEur — the initial
  // ticket at year 0, plus one entry per pro-rata follow-on at its own
  // yearsFromNow (FutureRoundInput's own field). Every amount here is
  // NEGATIVE (capital going out). When a follow-on round's timing wasn't
  // supplied, its cost still counts in totalCapitalInvestedEur but can't
  // be dated for XIRR — the caller decides how to handle that gap (see
  // scenario-returns.test.ts for the single-flow degenerate case this
  // naturally produces when no follow-on is dated at all).
  cashOutflows: CashFlow[];
}

export interface ScenarioInput {
  label: string;
  probabilityPct: number;
  exitValueEur: number;
  horizonYears: number;
}

export interface ScenarioResult extends ScenarioInput {
  proceedsEur: number;
  moic: number;
  // -1 for a total loss (see computeXirr — -100% is a defined rate, not an
  // unknown one, Prompt 409). null only when the cash-flow timeline
  // genuinely has no rate of return (nothing was ever invested) or the
  // solver didn't converge — never coerced to 0 or omitted silently.
  irr: number | null;
}

export interface ScenarioAggregate {
  probabilitiesSumPct: number;
  probabilitiesValid: boolean; // true iff probabilitiesSumPct ≈ 100
  // All three null together when probabilitiesValid is false (408 §A.2.2:
  // "nunca calcules com soma ≠ 100 em silêncio"), and weightedIrr alone
  // null when any individual scenario's own irr is null (§A.2's
  // "desconhecido nunca vira valor médio" — one unknown rate makes the
  // weighted rate unknown too, not zero and not silently dropped).
  weightedMoic: number | null;
  weightedIrr: number | null;
  expectedValueEur: number | null;
}

const PROBABILITY_SUM_EPSILON = 0.01;

function proceedsFor(ownership: ScenarioOwnership, exitValueEur: number): number {
  return (ownership.ownershipAtExitPct / 100) * exitValueEur;
}

function irrFor(ownership: ScenarioOwnership, proceedsEur: number, horizonYears: number): number | null {
  // Degenerate case, called out explicitly by 408 §A.2.3: a single capital
  // call at year 0 (no follow-ons, or none with known timing) reduces to
  // plain CAGR — computed in closed form rather than through the numeric
  // solver, which would converge to the same number but isn't guaranteed
  // exact and is strictly more code to trust for the common case.
  if (ownership.cashOutflows.length <= 1 && (ownership.cashOutflows[0]?.yearsFromNow ?? 0) === 0) {
    const invested = -(ownership.cashOutflows[0]?.amountEur ?? -ownership.totalCapitalInvestedEur);
    if (invested <= 0 || horizonYears <= 0) return null;
    const multiple = proceedsEur / invested;
    // Prompt 409 — same total-loss convention as computeXirr: multiple 0
    // (Failure, proceeds 0) is IRR -100%, not unknown. multiple negative
    // stays impossible/null (proceeds and invested capital are both
    // non-negative by construction elsewhere in this domain — this branch
    // is defensive only, never expected to fire).
    if (multiple < 0) return null;
    if (multiple === 0) return -1;
    return Math.pow(multiple, 1 / horizonYears) - 1;
  }
  return computeXirr([...ownership.cashOutflows, { yearsFromNow: horizonYears, amountEur: proceedsEur }]);
}

export function computeScenarioReturns(
  scenarios: ScenarioInput[], ownership: ScenarioOwnership,
): { scenarios: ScenarioResult[]; aggregate: ScenarioAggregate } {
  const results: ScenarioResult[] = scenarios.map((s) => {
    const proceedsEur = proceedsFor(ownership, s.exitValueEur);
    const moic = ownership.totalCapitalInvestedEur > 0 ? proceedsEur / ownership.totalCapitalInvestedEur : 0;
    const irr = irrFor(ownership, proceedsEur, s.horizonYears);
    return { ...s, proceedsEur, moic, irr };
  });

  const probabilitiesSumPct = scenarios.reduce((sum, s) => sum + s.probabilityPct, 0);
  const probabilitiesValid = Math.abs(probabilitiesSumPct - 100) <= PROBABILITY_SUM_EPSILON;

  let weightedMoic: number | null = null;
  let weightedIrr: number | null = null;
  let expectedValueEur: number | null = null;
  if (probabilitiesValid && results.length > 0) {
    weightedMoic = results.reduce((sum, r) => sum + (r.probabilityPct / 100) * r.moic, 0);
    expectedValueEur = results.reduce((sum, r) => sum + (r.probabilityPct / 100) * r.proceedsEur, 0);
    weightedIrr = results.some((r) => r.irr == null)
      ? null
      : results.reduce((sum, r) => sum + (r.probabilityPct / 100) * (r.irr as number), 0);
  }

  return { scenarios: results, aggregate: { probabilitiesSumPct, probabilitiesValid, weightedMoic, weightedIrr, expectedValueEur } };
}

// VC Method — 408 §A.2.5. Pure algebraic inversion of the same
// proceeds/MOIC relationship computeScenarioReturns uses (proceeds =
// ownership% * exit; moic = proceeds / capital invested) rather than a
// second, parallel implementation: solving moic = target for exit gives
// exit = target * capitalInvested / (ownership% / 100) directly, no
// numeric search needed (unlike IRR, this relationship is linear in exit).
export function computeRequiredExit(targetMultiple: number, ownership: ScenarioOwnership): number | null {
  if (ownership.ownershipAtExitPct <= 0 || targetMultiple <= 0) return null;
  return (targetMultiple * ownership.totalCapitalInvestedEur) / (ownership.ownershipAtExitPct / 100);
}
