// Prompt 444 §A/§D — pure functions for Market Thesis: sanitizing input,
// and deciding whether a PATCH actually changed content (so `version` only
// bumps on a real edit, never on a no-op resubmit). Same "business rules
// live as pure functions, tested" discipline as rules.ts.
export interface MarketThesisFields {
  product_summary: string | null;
  core_problem: string | null;
  primary_user: string | null;
  economic_buyer: string | null;
  beachhead: string | null;
  geography: string | null;
  primary_use_case: string | null;
  adjacent_technologies: string[];
  excluded_markets: string[];
}

export const MARKET_THESIS_TEXT_MAX = 300;
export const MARKET_THESIS_ARRAY_ITEM_MAX = 60;
export const MARKET_THESIS_ARRAY_MAX_ITEMS = 8;
export const MAX_ACTIVE_HYPOTHESES = 3;

// Same discipline as approach_note/0249: trim, cap length, empty -> null
// (never an empty string sitting in the column).
export function sanitizeMarketThesisText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MARKET_THESIS_TEXT_MAX);
  return trimmed || null;
}

export function sanitizeMarketThesisArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= MARKET_THESIS_ARRAY_MAX_ITEMS) break;
    if (typeof item !== 'string') continue;
    const trimmed = item.trim().slice(0, MARKET_THESIS_ARRAY_ITEM_MAX);
    if (trimmed) out.push(trimmed);
  }
  return out;
}

export function sanitizeMarketThesisFields(input: Record<string, unknown>): MarketThesisFields {
  return {
    product_summary: sanitizeMarketThesisText(input.product_summary),
    core_problem: sanitizeMarketThesisText(input.core_problem),
    primary_user: sanitizeMarketThesisText(input.primary_user),
    economic_buyer: sanitizeMarketThesisText(input.economic_buyer),
    beachhead: sanitizeMarketThesisText(input.beachhead),
    geography: sanitizeMarketThesisText(input.geography),
    primary_use_case: sanitizeMarketThesisText(input.primary_use_case),
    adjacent_technologies: sanitizeMarketThesisArray(input.adjacent_technologies),
    excluded_markets: sanitizeMarketThesisArray(input.excluded_markets),
  };
}

function sameArray(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

// A reorder-only edit to a tag array isn't new content — sameArray treats
// the two arrays as sets for this comparison.
export function marketThesisContentChanged(existing: MarketThesisFields | null, next: MarketThesisFields): boolean {
  if (!existing) return true;
  return existing.product_summary !== next.product_summary
    || existing.core_problem !== next.core_problem
    || existing.primary_user !== next.primary_user
    || existing.economic_buyer !== next.economic_buyer
    || existing.beachhead !== next.beachhead
    || existing.geography !== next.geography
    || existing.primary_use_case !== next.primary_use_case
    || !sameArray(existing.adjacent_technologies, next.adjacent_technologies)
    || !sameArray(existing.excluded_markets, next.excluded_markets);
}

// §D — increments only on real content change; a no-op resubmit (or a
// touch that only affects updated_at) leaves version exactly where it was.
export function nextMarketThesisVersion(existing: (MarketThesisFields & { version: number }) | null, next: MarketThesisFields): number {
  if (!existing) return 1;
  return marketThesisContentChanged(existing, next) ? existing.version + 1 : existing.version;
}

// §C.1 — "completa a Market Thesis primeiro": without these two, there is
// no thesis to reason a hypothesis from.
export function marketThesisReadyForHypotheses(thesis: { product_summary: string | null; core_problem: string | null } | null): boolean {
  return !!thesis?.product_summary?.trim() && !!thesis?.core_problem?.trim();
}

// §B — the hard cap, checked server-side wherever a row could become (or
// stay) 'active': creating new ones, or re-activating an archived one.
// activeCount excludes the row(s) being changed; addingCount is how many
// would newly become active as a result of this call.
export function canHaveActiveHypotheses(activeCount: number, addingCount: number): boolean {
  return activeCount + addingCount <= MAX_ACTIVE_HYPOTHESES;
}
