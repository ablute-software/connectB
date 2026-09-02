// Prompt 534 Phase 1 — Round Blueprint: the founder's own runway and Ask,
// computed from their own numbers.
//
// Pure, like dilution.ts and berkus.ts: no I/O, no Intl, no formatting, no
// randomness. Every number the panel shows comes from here, so every number
// the panel shows is testable without a browser or a database. Watson never
// computes anything in this feature (Phase 3 only explains), which is only a
// meaningful promise because the arithmetic lives in one place that never
// calls a model.
//
// FOUNDER-ONLY. Nothing here is investor-facing. The one thing that ever
// crosses is what the founder explicitly writes back into the existing `orgs`
// round fields via "Apply to my round", which then follows today's visibility
// rules unchanged. See CLAUDE.md's startup-performance privacy rule.

export interface RunwayTranche {
  /** 0 = lands before month 1 (the usual "the round closes now" case). */
  month: number;
  eur: number;
  /** Set once "Add tranches to Roadmap" has created the event, so re-running updates instead of duplicating. */
  roadmapEventId?: string | null;
}

export interface RunwayBurnStep {
  /** Applies from this month onward, until a later step supersedes it. */
  month: number;
  eur: number;
  label?: string;
}

export interface RunwayInputs {
  startingCashEur: number;
  raise: { totalEur: number; tranches: RunwayTranche[] };
  burn: { startEur: number; steps: RunwayBurnStep[] };
  revenue: { startMrrEur: number; monthlyGrowthPct: number; grossMarginPct: number };
  horizonMonths: number;
  /** How long raising a seed actually takes — drives "start raising by month N". */
  seedLeadMonths: number;
}

export interface RunwayPoint {
  month: number;
  revenue: number;
  grossProfit: number;
  burn: number;
  /** burn minus gross profit: what the month actually costs. Negative once the company earns more than it spends. */
  netBurn: number;
  cashIn: number;
  cashEnd: number;
}

export interface RunwayMarkers {
  /**
   * The first month that ENDS below zero — i.e. the first month the company
   * cannot pay for. The last survivable month is therefore runwayEndMonth - 1,
   * which is why a flat 120k/10k plan gives runwayEndMonth 13 and twelve months
   * of runway. null means the plan survives the whole horizon.
   */
  runwayEndMonth: number | null;
  /** runwayEndMonth - seedLeadMonths, floored at 1. The marker almost no founder plots. */
  startRaisingMonth: number | null;
  /** First month gross profit covers burn. null if it never does inside the horizon. */
  breakEvenMonth: number | null;
  minCashEur: number;
  minCashMonth: number;
}

export const DEFAULT_HORIZON_MONTHS = 36;
export const DEFAULT_SEED_LEAD_MONTHS = 6;

/**
 * Default yes-rate for the outreach plan. A labelled assumption, not a
 * measured figure — the panel says so and lets the founder change it. It is
 * deliberately NOT derived from the founder's own pipeline: that would make an
 * encouraging plan out of a small sample, and this number is meant to be
 * conservative and boring.
 */
export const DEFAULT_YES_RATE_PCT = 20;

function burnForMonth(burn: RunwayInputs['burn'], month: number): number {
  let value = burn.startEur;
  // Steps are "from this month on", so the applicable one is the latest step
  // at or before this month. Sorted here rather than trusting input order.
  for (const step of [...burn.steps].sort((a, b) => a.month - b.month)) {
    if (step.month <= month) value = step.eur;
  }
  return value;
}

/**
 * Month 0 is the opening position: no burn, no revenue, and any tranche that
 * lands "now". Months 1..horizon are real months. Keeping month 0 explicit is
 * what lets the chart show the opening injection instead of folding it
 * invisibly into starting cash.
 */
export function simulateRunway(inputs: RunwayInputs): { points: RunwayPoint[]; markers: RunwayMarkers } {
  const horizon = Math.max(1, Math.floor(inputs.horizonMonths));
  const growth = 1 + inputs.revenue.monthlyGrowthPct / 100;
  const marginRate = inputs.revenue.grossMarginPct / 100;

  const points: RunwayPoint[] = [];
  const openingCashIn = inputs.raise.tranches
    .filter((t) => t.month <= 0)
    .reduce((sum, t) => sum + t.eur, 0);

  let cash = inputs.startingCashEur + openingCashIn;
  points.push({ month: 0, revenue: 0, grossProfit: 0, burn: 0, netBurn: 0, cashIn: openingCashIn, cashEnd: cash });

  for (let month = 1; month <= horizon; month++) {
    const revenue = inputs.revenue.startMrrEur * Math.pow(growth, month - 1);
    const grossProfit = revenue * marginRate;
    const burn = burnForMonth(inputs.burn, month);
    const netBurn = burn - grossProfit;
    const cashIn = inputs.raise.tranches
      .filter((t) => t.month === month)
      .reduce((sum, t) => sum + t.eur, 0);
    cash = cash + cashIn - netBurn;
    points.push({ month, revenue, grossProfit, burn, netBurn, cashIn, cashEnd: cash });
  }

  const runwayEndMonth = points.find((p) => p.month > 0 && p.cashEnd < 0)?.month ?? null;
  const breakEvenMonth = points.find((p) => p.month > 0 && p.grossProfit >= p.burn)?.month ?? null;
  const startRaisingMonth = runwayEndMonth == null ? null : Math.max(1, runwayEndMonth - inputs.seedLeadMonths);

  let minCashEur = points[0].cashEnd;
  let minCashMonth = 0;
  for (const p of points) {
    if (p.cashEnd < minCashEur) { minCashEur = p.cashEnd; minCashMonth = p.month; }
  }

  return { points, markers: { runwayEndMonth, startRaisingMonth, breakEvenMonth, minCashEur, minCashMonth } };
}

/** True when the plan is still solvent at the end of `targetRunwayMonths`. */
function survivesThrough(inputs: RunwayInputs, targetRunwayMonths: number): boolean {
  const { points } = simulateRunway({ ...inputs, horizonMonths: Math.max(inputs.horizonMonths, targetRunwayMonths) });
  return points.filter((p) => p.month > 0 && p.month <= targetRunwayMonths).every((p) => p.cashEnd >= 0);
}

/** Scale the raise to `totalEur`, keeping the tranche SHAPE (or a single tranche at month 0 if there is none). */
function withRaiseTotal(inputs: RunwayInputs, totalEur: number): RunwayInputs {
  const current = inputs.raise.tranches.reduce((sum, t) => sum + t.eur, 0);
  const tranches: RunwayTranche[] = current > 0
    ? inputs.raise.tranches.map((t) => ({ ...t, eur: (t.eur / current) * totalEur }))
    : [{ month: 0, eur: totalEur }];
  return { ...inputs, raise: { totalEur, tranches } };
}

/**
 * "I want N months of runway — how much do I need?" Bisection rather than a
 * closed form because revenue compounds and burn steps, so cash at month N is
 * not linear in the raise in any shape worth deriving by hand.
 *
 * Returns 0 when the plan already survives with no money at all, and the upper
 * bound when even that is not enough (rather than looping forever) — the caller
 * can tell, because simulating the result will still fail.
 */
export function solveRaiseForRunway(inputs: RunwayInputs, targetRunwayMonths: number): number {
  if (targetRunwayMonths <= 0) return 0;
  if (survivesThrough(withRaiseTotal(inputs, 0), targetRunwayMonths)) return 0;

  // Grow the ceiling until it works, so the bracket is always valid before
  // bisecting. Bounded so a pathological input cannot spin.
  let hi = Math.max(1000, Math.abs(inputs.burn.startEur) * targetRunwayMonths || 1000);
  for (let i = 0; i < 40 && !survivesThrough(withRaiseTotal(inputs, hi), targetRunwayMonths); i++) hi *= 2;
  if (!survivesThrough(withRaiseTotal(inputs, hi), targetRunwayMonths)) return hi;

  let lo = 0;
  // ~40 halvings takes any realistic bracket well below one euro.
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (survivesThrough(withRaiseTotal(inputs, mid), targetRunwayMonths)) hi = mid; else lo = mid;
  }
  return hi;
}

export type DragKind = 'cash' | 'burn' | 'revenue';

/**
 * Move one point on the chart, through exactly ONE lever.
 *
 * A cash value at month 8 could be explained by a bigger raise, a smaller burn
 * or faster revenue — three valid answers. A solver that picked one silently
 * would be inventing intent, so the founder always chooses the lever and this
 * function only ever moves that one. Everything else in `inputs` is returned
 * untouched.
 */
export function applyDrag(inputs: RunwayInputs, kind: DragKind, month: number, newValue: number): RunwayInputs {
  if (kind === 'burn') {
    const steps = inputs.burn.steps.filter((s) => s.month !== month);
    return { ...inputs, burn: { ...inputs.burn, steps: [...steps, { month, eur: newValue }].sort((a, b) => a.month - b.month) } };
  }

  if (kind === 'revenue') {
    // Solve growth so revenue at `month` equals newValue. Month 1 IS the
    // starting MRR (growth has not applied yet), so that is the only month
    // where the honest lever is the starting value itself, not the rate.
    if (month <= 1 || inputs.revenue.startMrrEur <= 0 || newValue <= 0) {
      return { ...inputs, revenue: { ...inputs.revenue, startMrrEur: Math.max(0, newValue) } };
    }
    const ratio = newValue / inputs.revenue.startMrrEur;
    const monthlyGrowthPct = (Math.pow(ratio, 1 / (month - 1)) - 1) * 100;
    return { ...inputs, revenue: { ...inputs.revenue, monthlyGrowthPct } };
  }

  // 'cash' — change the raise so the month ends on newValue. Cash is linear in
  // the raise for a fixed tranche shape (burn and revenue do not depend on it),
  // so the delta transfers one-for-one; no bisection needed. It is applied to
  // the latest tranche at or before this month, because a tranche arriving
  // AFTER the dragged month cannot affect it.
  const { points } = simulateRunway(inputs);
  const current = points.find((p) => p.month === month);
  if (!current) return inputs;
  const delta = newValue - current.cashEnd;

  const eligible = inputs.raise.tranches
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.month <= month)
    .sort((a, b) => b.t.month - a.t.month)[0];

  if (!eligible) {
    const tranches = [...inputs.raise.tranches, { month: 0, eur: Math.max(0, delta) }];
    return { ...inputs, raise: { totalEur: tranches.reduce((s, t) => s + t.eur, 0), tranches } };
  }
  const tranches = inputs.raise.tranches.map((t, i) => (i === eligible.i ? { ...t, eur: t.eur + delta } : t));
  return { ...inputs, raise: { totalEur: tranches.reduce((s, t) => s + t.eur, 0), tranches } };
}

export interface OutreachPlan {
  ticketsNeeded: number;
  conversationsNeeded: number;
  weeksOfOutreach: number;
}

/**
 * The line that turns an amount into a calendar: "€400K at €25K tickets ≈ 16
 * yes → ~80 conversations → at 20/week, 4+ weeks of outreach alone."
 *
 * Deliberately ceilings at every step. Half a conversation does not exist, and
 * rounding down here would flatter the plan, which is the one thing an outreach
 * estimate must not do.
 */
export function outreachPlan(
  raiseEur: number,
  avgTicketEur: number,
  weeklyCap: number,
  assumedYesRatePct: number = DEFAULT_YES_RATE_PCT,
): OutreachPlan {
  if (raiseEur <= 0 || avgTicketEur <= 0) return { ticketsNeeded: 0, conversationsNeeded: 0, weeksOfOutreach: 0 };
  const ticketsNeeded = Math.ceil(raiseEur / avgTicketEur);
  const yesRate = assumedYesRatePct > 0 ? assumedYesRatePct / 100 : 0;
  const conversationsNeeded = yesRate > 0 ? Math.ceil(ticketsNeeded / yesRate) : 0;
  const weeksOfOutreach = weeklyCap > 0 ? Math.ceil(conversationsNeeded / weeklyCap) : 0;
  return { ticketsNeeded, conversationsNeeded, weeksOfOutreach };
}

/**
 * Fit a single monthly growth rate through two revenue anchors — the shape a
 * financial plan usually states ("ARR 19.1K at month 6, 281K at month 24").
 * Returns null when the anchors cannot define a rate, rather than a plausible
 * number: an empty field the founder must fill is honest, a fabricated curve
 * is not.
 */
export function fitMonthlyGrowthPct(
  from: { month: number; mrrEur: number },
  to: { month: number; mrrEur: number },
): number | null {
  if (from.mrrEur <= 0 || to.mrrEur <= 0 || to.month <= from.month) return null;
  return (Math.pow(to.mrrEur / from.mrrEur, 1 / (to.month - from.month)) - 1) * 100;
}

/** Back out the month-1 MRR implied by an anchor and a growth rate. */
export function startMrrFromAnchor(anchor: { month: number; mrrEur: number }, monthlyGrowthPct: number): number | null {
  if (anchor.mrrEur <= 0 || anchor.month < 1) return null;
  const growth = 1 + monthlyGrowthPct / 100;
  if (growth <= 0) return null;
  return anchor.mrrEur / Math.pow(growth, anchor.month - 1);
}

/**
 * The concrete rule from the 02/09 analysis: a convertible must not mature
 * before there is plausibly a round to convert into. Exposed here (pure, from
 * Phase 1's own markers) so Phase 2's terms table reuses it rather than
 * restating the arithmetic.
 */
export const MATURITY_BUFFER_MONTHS = 6;

export function minimumMaturityMonths(markers: RunwayMarkers, horizonMonths: number): number {
  const runway = markers.runwayEndMonth ?? horizonMonths;
  return runway + MATURITY_BUFFER_MONTHS;
}
