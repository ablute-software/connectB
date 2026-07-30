// Investor Workspace Tools (prompt 62.1) — dilution/ownership calculator.
// Pure function, no I/O, no schema — a calculation, not a record. "Valuation"
// as stored on orgs.round_valuation_eur has no documented pre/post-money
// convention anywhere in this codebase, so the basis is an explicit input
// here (default post-money, the more common framing for a headline "raising
// €X at €Y valuation" figure) rather than a silent assumption.
export interface DilutionInput {
  ticketEur: number;
  roundValuationEur: number;
  roundTargetEur: number; // total round size, used only when basis is pre-money
  valuationBasis: 'pre_money' | 'post_money';
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
