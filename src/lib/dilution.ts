// Investor Workspace Tools (prompt 62.1) — dilution/ownership calculator.
// Pure function, no I/O, no schema — a calculation, not a record.
//
// Prompt 115 Block E: orgs.round_valuation_basis (migration 0111, PROPOSE
// ONLY — not applied without Nuno's explicit go-ahead) finally makes the
// basis an explicit stored fact instead of a guess every reader used to make
// independently. Until that migration lands (or for any org that hasn't set
// it), every caller here falls back to 'pre_money' — see
// round-valuation-basis-capability.ts for the probe that flips this over
// once the column exists.
export type ValuationBasis = 'pre_money' | 'post_money';

export interface DilutionInput {
  ticketEur: number;
  roundValuationEur: number;
  roundTargetEur: number; // total round size, used only when basis is pre-money
  valuationBasis: ValuationBasis;
  futureRoundDilutionsPct: number[]; // e.g. [20, 15] for two hypothetical future rounds
}

export interface DilutionResult {
  postMoneyEur: number;
  ownershipAfterThisRoundPct: number;
  ownershipAfterFutureRoundsPct: number[]; // cumulative, one entry per future round
}

export function computeDilution(input: DilutionInput): DilutionResult {
  const postMoneyEur = input.valuationBasis === 'post_money'
    ? input.roundValuationEur
    : input.roundValuationEur + input.roundTargetEur;

  const ownershipAfterThisRoundPct = postMoneyEur > 0 ? (input.ticketEur / postMoneyEur) * 100 : 0;

  const ownershipAfterFutureRoundsPct: number[] = [];
  let running = ownershipAfterThisRoundPct;
  for (const dilutionPct of input.futureRoundDilutionsPct) {
    running = running * (1 - dilutionPct / 100);
    ownershipAfterFutureRoundsPct.push(running);
  }

  return { postMoneyEur, ownershipAfterThisRoundPct, ownershipAfterFutureRoundsPct };
}

// The Company tab's "both figures shown live underneath" display (Block E) —
// NOT a destructive conversion of the stored number, just the arithmetic
// implied by whichever basis the founder declares.
export interface DerivedValuation { preMoneyEur: number; postMoneyEur: number; roundEur: number }

export function deriveValuation(basis: ValuationBasis, valuationEur: number, roundTargetEur: number): DerivedValuation {
  if (basis === 'post_money') {
    return { postMoneyEur: valuationEur, preMoneyEur: valuationEur - roundTargetEur, roundEur: roundTargetEur };
  }
  return { preMoneyEur: valuationEur, postMoneyEur: valuationEur + roundTargetEur, roundEur: roundTargetEur };
}
