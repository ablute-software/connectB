// Prompt 373 §F — group-by-group publication. Pure projection: given the
// founder's chosen visible groups and the full Market data payload, returns
// EXACTLY the groups that are on, nothing else — a group missing from
// `visibleGroups` must never appear in the result, whatever data it has.
// The server route (market-data/investor-projection.ts's caller) enforces
// fail-closed by never even QUERYING a group's data unless its key is
// present here — this function is the second, defense-in-depth layer: even
// if a caller passed every group's data regardless, an off group's data
// never reaches the return value.
export type MarketGroupKey = 'rings' | 'competitors' | 'rounds' | 'trends' | 'regulatory' | 'definition';
export const MARKET_GROUP_KEYS: MarketGroupKey[] = ['rings', 'competitors', 'rounds', 'trends', 'regulatory', 'definition'];

export interface MarketInvestorPayload {
  rings?: unknown;
  competitors?: unknown;
  rounds?: unknown;
  trends?: unknown;
  regulatory?: unknown;
  definition?: unknown;
}

export function projectMarketDataForInvestor(
  visibleGroups: string[], full: MarketInvestorPayload,
): Partial<MarketInvestorPayload> {
  const on = new Set(visibleGroups);
  const out: Partial<MarketInvestorPayload> = {};
  for (const key of MARKET_GROUP_KEYS) {
    if (on.has(key) && key in full) out[key] = full[key];
  }
  return out;
}
