import { describe, expect, it } from 'vitest';
import { convertSafe, convertSafes, type PricedRound, type SafeNote } from './safe-conversion';

// A clean round: €4M pre-money, 4,000,000 shares pre-round -> €1/share.
const ROUND: PricedRound = { preMoneyEur: 4_000_000, newMoneyEur: 1_000_000, fullyDilutedSharesPreRound: 4_000_000 };

describe('convertSafe', () => {
  it('converts at the round price when the SAFE has no cap or discount', () => {
    const note: SafeNote = { investedEur: 100_000 };
    const r = convertSafe(note, ROUND);
    expect(r.conversionPricePerShare).toBe(1);
    expect(r.sharesIssued).toBe(100_000);
  });

  it('converts at the cap price when the cap is more favorable than the round price', () => {
    // Cap of €2M against the same 4,000,000 shares -> €0.50/share, cheaper than the €1 round price.
    const note: SafeNote = { investedEur: 100_000, valuationCapEur: 2_000_000 };
    const r = convertSafe(note, ROUND);
    expect(r.conversionPricePerShare).toBe(0.5);
    expect(r.sharesIssued).toBe(200_000);
  });

  it('ignores the cap when the round price is already cheaper (cap not triggered)', () => {
    // Cap of €8M -> €2/share, worse for the investor than the €1 round price, so round price wins.
    const note: SafeNote = { investedEur: 100_000, valuationCapEur: 8_000_000 };
    const r = convertSafe(note, ROUND);
    expect(r.conversionPricePerShare).toBe(1);
  });

  it('converts at the discounted price when only a discount is set', () => {
    const note: SafeNote = { investedEur: 100_000, discountPct: 20 };
    const r = convertSafe(note, ROUND);
    expect(r.conversionPricePerShare).toBe(0.8); // €1 x (1 - 20%)
    expect(r.sharesIssued).toBe(125_000);
  });

  it('picks whichever of cap or discount gives the most shares (cap+discount SAFE)', () => {
    // Cap -> €0.50/share. Discount (20% off €1 round price) -> €0.80/share.
    // The cap is more favorable (lower price), so it wins even though both are offered.
    const note: SafeNote = { investedEur: 100_000, valuationCapEur: 2_000_000, discountPct: 20 };
    const r = convertSafe(note, ROUND);
    expect(r.conversionPricePerShare).toBe(0.5);
  });

  it('never returns a destructive/negative ownership percentage for a realistic investment', () => {
    const note: SafeNote = { investedEur: 100_000, valuationCapEur: 2_000_000 };
    const r = convertSafe(note, ROUND);
    expect(r.ownershipPct).toBeGreaterThan(0);
    expect(r.ownershipPct).toBeLessThan(100);
  });

  it('computes the effective valuation implied by the conversion price', () => {
    const note: SafeNote = { investedEur: 100_000, valuationCapEur: 2_000_000 };
    const r = convertSafe(note, ROUND);
    expect(r.effectiveValuationEur).toBe(2_000_000); // the cap itself, since that's what fired
  });
});

describe('convertSafes', () => {
  it('converts each SAFE independently against the same round', () => {
    const notes: SafeNote[] = [
      { investedEur: 100_000, valuationCapEur: 2_000_000 },
      { investedEur: 50_000, discountPct: 10 },
    ];
    const results = convertSafes(notes, ROUND);
    expect(results).toHaveLength(2);
    expect(results[0].conversionPricePerShare).toBe(0.5);
    expect(results[1].conversionPricePerShare).toBe(0.9);
  });
});
