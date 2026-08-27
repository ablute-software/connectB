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
  // Prompt 408 §A.1 — richer, OPTIONAL alternative to futureRoundDilutionsPct
  // above. When set, this drives ownershipAfterFutureRoundsPct instead (and
  // is the only way to get totalCapitalInvestedEur/proRataStatusByRound) —
  // futureRoundDilutionsPct is ignored in that case. Every existing caller
  // leaves this unset, so computeDilution's behavior for them is byte-for-byte
  // unchanged; this is additive, not a signature break.
  futureRounds?: FutureRoundInput[];
}

// Prompt 408 §A.1 — one hypothetical future round, richer than a bare
// dilution percentage.
export interface FutureRoundInput {
  dilutionPct: number; // same meaning as futureRoundDilutionsPct's own entries
  // Option pool expansion — a pool carve-out dilutes existing shareholders
  // the same moment the round does. Simple model, composed multiplicatively
  // with dilutionPct (not summed): retained fraction = (1-dilutionPct/100)
  // * (1-optionPoolExpansionPct/100). This is the one formula 408 §A.1.1
  // asks to be documented in code — this comment is that documentation.
  optionPoolExpansionPct?: number;
  // Pro-rata participation — when true, ownership does NOT dilute this
  // round (the investor bought enough of the round to hold their %
  // constant); the cost of doing so instead grows totalCapitalInvestedEur.
  // Requires roundValuationEur (below) to price that cost; without it,
  // pro-rata is unavailable for THIS round specifically (408 §A.1.2's own
  // words) — computeDilution falls back to normal dilution for that round
  // and reports the gap via proRataStatusByRound, rather than silently
  // pretending pro-rata happened.
  participateProRata?: boolean;
  // This round's own POST-money valuation — the pricing basis for the
  // pro-rata cost formula below. Only meaningful/required when
  // participateProRata is true.
  roundValuationEur?: number;
  // Prompt 408 §A.2 — when this round happens, for XIRR's cash-flow
  // timeline (computeScenarioReturns, scenario-returns.ts). Optional here
  // because plain ownership/MOIC math (this file) never needed dated cash
  // flows — only the IRR consumer does, and it validates its own presence
  // where it actually matters.
  yearsFromNow?: number;
}

export type ProRataStatus = 'not_requested' | 'applied' | 'unavailable_no_valuation';

export interface DilutionResult {
  postMoneyEur: number;
  ownershipAfterThisRoundPct: number;
  ownershipAfterFutureRoundsPct: number[]; // cumulative, one entry per future round
  // Present only when futureRounds was used. ticketEur plus every round's
  // pro-rata cost (when applied) — the "capital total investido" 408
  // §A.1.2 asks for.
  totalCapitalInvestedEur?: number;
  // Present only when futureRounds was used. One entry per future round,
  // same order — the UI's source for "pro-rata unavailable for round N,
  // missing its valuation" rather than a silently-wrong result.
  proRataStatusByRound?: ProRataStatus[];
}

export function computeDilution(input: DilutionInput): DilutionResult {
  const postMoneyEur = input.valuationBasis === 'post_money'
    ? input.roundValuationEur
    : input.roundValuationEur + input.roundTargetEur;

  const ownershipAfterThisRoundPct = postMoneyEur > 0 ? (input.ticketEur / postMoneyEur) * 100 : 0;

  if (!input.futureRounds) {
    const ownershipAfterFutureRoundsPct: number[] = [];
    let running = ownershipAfterThisRoundPct;
    for (const dilutionPct of input.futureRoundDilutionsPct) {
      running = running * (1 - dilutionPct / 100);
      ownershipAfterFutureRoundsPct.push(running);
    }
    return { postMoneyEur, ownershipAfterThisRoundPct, ownershipAfterFutureRoundsPct };
  }

  const ownershipAfterFutureRoundsPct: number[] = [];
  const proRataStatusByRound: ProRataStatus[] = [];
  let running = ownershipAfterThisRoundPct;
  let totalCapitalInvestedEur = input.ticketEur;
  for (const round of input.futureRounds) {
    const poolFactor = round.optionPoolExpansionPct != null ? 1 - round.optionPoolExpansionPct / 100 : 1;
    if (round.participateProRata && round.roundValuationEur != null) {
      // Simplified pro-rata pricing, documented (408 §A.1.2's own words:
      // "o custo do pro-rata calculado do post-money implícito dessa
      // ronda"): your check = your CURRENT ownership % of the round's
      // overall post-money. This is the informal heuristic investors
      // actually reach for ("my pro-rata is roughly my % of the round
      // size"), not a full cap-table simulation — deliberately, matching
      // the option-pool mechanic's own "modelo simples" framing right
      // above. Ownership is unchanged: buying your own pro-rata by
      // definition offsets the dilution this round would otherwise cause,
      // option pool expansion included — a partial pro-rata that offsets
      // only the money round's own dilution but not the pool's isn't
      // modeled here; there's no input to express that distinction.
      proRataStatusByRound.push('applied');
      totalCapitalInvestedEur += (running / 100) * round.roundValuationEur;
    } else {
      proRataStatusByRound.push(round.participateProRata ? 'unavailable_no_valuation' : 'not_requested');
      running = running * (1 - round.dilutionPct / 100) * poolFactor;
    }
    ownershipAfterFutureRoundsPct.push(running);
  }

  return { postMoneyEur, ownershipAfterThisRoundPct, ownershipAfterFutureRoundsPct, totalCapitalInvestedEur, proRataStatusByRound };
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
