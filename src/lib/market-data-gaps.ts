// Prompt 373 §E — freshness + "the investor's lens" for Market data. Kept
// as its own small, dedicated rule set rather than widening
// company-gaps.ts's GapContext (which carries claims/founders/stage, never
// rings/competitors/research-item state) — same spirit as that engine
// (mechanical rules, never generated text), narrower scope on purpose.
export type MarketGapRule = 'no_bottom_up_sizing' | 'no_incumbent' | 'no_competitor_funding' | 'stale';
export interface MarketGap { rule: MarketGapRule; message: string; }

const STALE_MONTHS = 12;

export function isStale(dateIso: string | null | undefined, now: Date): boolean {
  if (!dateIso) return false;
  const ageMs = now.getTime() - new Date(dateIso).getTime();
  return ageMs > STALE_MONTHS * 30.44 * 24 * 60 * 60 * 1000;
}

export interface MarketGapRing { sizeMethod: 'bottom_up' | 'top_down' | 'report' | null; sizeValueEur: number | null }
export interface MarketGapCompetitor { companyType: string | null; hasFundingData: boolean }

// Mechanical, not AI-generated text — same discipline as company-gaps.ts's
// own rules, just scoped to Market data's own shape instead of claims.
export function marketDataGaps(rings: MarketGapRing[], competitors: MarketGapCompetitor[]): MarketGap[] {
  const gaps: MarketGap[] = [];

  const sizedRings = rings.filter((r) => r.sizeValueEur != null);
  if (sizedRings.length > 0 && !sizedRings.some((r) => r.sizeMethod === 'bottom_up')) {
    gaps.push({
      rule: 'no_bottom_up_sizing',
      message: "You don't have bottom-up sizing, only top-down/report figures — an investor will ask you to show the math, not just cite a source.",
    });
  }

  if (competitors.length > 0 && !competitors.some((c) => c.companyType === 'incumbent')) {
    gaps.push({
      rule: 'no_incumbent',
      message: "Your competitor list has no incumbent — investors will assume you don't know who you're really up against.",
    });
  }

  if (competitors.length > 0 && !competitors.some((c) => c.hasFundingData)) {
    gaps.push({
      rule: 'no_competitor_funding',
      message: 'None of your competitors has known funding — without it, there is no round comparison to make.',
    });
  }

  return gaps;
}

export interface FreshnessCheckable { label: string; sourceOrUpdatedAt: string | null }
export interface FreshnessResult { label: string; stale: boolean }

export function freshnessReport(items: FreshnessCheckable[], now: Date): FreshnessResult[] {
  return items.map((i) => ({ label: i.label, stale: isStale(i.sourceOrUpdatedAt, now) }));
}
