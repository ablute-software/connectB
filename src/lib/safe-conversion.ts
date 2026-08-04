// Investor Workspace Tools (Prompt 115 Block G, optional) — SAFE (Simple
// Agreement for Future Equity) conversion. Pure function, no I/O, no
// schema — a calculation, not a record, same convention as dilution.ts.
//
// Standard YC-style SAFE mechanics: at a priced round, a SAFE converts to
// equity at whichever price per share is most favorable to the investor —
// the valuation cap, the discount off the round's own price, or the round
// price itself if the SAFE is uncapped/discount-less. This handles ONE SAFE
// converting in isolation against an already-known round price; real cap
// tables with MULTIPLE SAFEs converting simultaneously have a genuine
// circular dependency (each SAFE's share count affects the fully-diluted
// count the others convert against) that this deliberately does not solve —
// flagged here rather than silently approximated.
export interface SafeNote {
  investedEur: number;
  valuationCapEur?: number; // undefined = uncapped
  discountPct?: number; // e.g. 20 for a 20% discount off the round price
}

export interface PricedRound {
  preMoneyEur: number;
  newMoneyEur: number; // new cash raised in this priced round, excluding SAFE conversions
  fullyDilutedSharesPreRound: number; // share count immediately before this round (excludes converting SAFEs)
}

export interface SafeConversionResult {
  conversionPricePerShare: number;
  sharesIssued: number;
  ownershipPct: number; // of the post-round fully diluted cap table
  effectiveValuationEur: number; // the valuation actually used to price this conversion
}

function pricePerShare(valuationEur: number, shares: number): number {
  return valuationEur / shares;
}

export function convertSafe(note: SafeNote, round: PricedRound): SafeConversionResult {
  const roundPricePerShare = pricePerShare(round.preMoneyEur, round.fullyDilutedSharesPreRound);

  const candidatePrices: number[] = [roundPricePerShare];
  if (note.valuationCapEur != null) {
    candidatePrices.push(pricePerShare(note.valuationCapEur, round.fullyDilutedSharesPreRound));
  }
  if (note.discountPct != null) {
    candidatePrices.push(roundPricePerShare * (1 - note.discountPct / 100));
  }
  // Lowest price per share = most shares for the same investment = most
  // favorable to the SAFE holder — that's the mechanism that actually fires.
  const conversionPricePerShare = Math.min(...candidatePrices);
  const sharesIssued = note.investedEur / conversionPricePerShare;

  const newInvestorShares = round.newMoneyEur / roundPricePerShare;
  const postRoundShares = round.fullyDilutedSharesPreRound + newInvestorShares + sharesIssued;
  const ownershipPct = (sharesIssued / postRoundShares) * 100;
  const effectiveValuationEur = conversionPricePerShare * round.fullyDilutedSharesPreRound;

  return { conversionPricePerShare, sharesIssued, ownershipPct, effectiveValuationEur };
}

// Convenience for the common "several SAFEs, one priced round" case, used
// sequentially — each SAFE converts against the round price (not against
// the others' just-issued shares), matching the "no circular solve" scope
// note above. Order does not change any individual SAFE's own numbers; it
// only affects the running `fullyDilutedSharesPreRound` snapshot used for
// each one's ownershipPct denominator, which real-world cap tables handle
// via a single simultaneous solve — flagged as the same simplification.
export function convertSafes(notes: SafeNote[], round: PricedRound): SafeConversionResult[] {
  return notes.map((note) => convertSafe(note, round));
}
