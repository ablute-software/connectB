import { describe, expect, it } from 'vitest';
import { INVESTOR_PLANS } from '@/lib/plans';
import { priceFor, type BillingMode } from '@/lib/investor-plan-pricing';

// Prompt 550 — no @testing-library in this project, so the toggle's effect is
// asserted through the pure helper the grid actually calls, as the prompt
// specifies. The rendered-and-visible half is covered in the browser, because
// that is the half that failed: 548 asserted the prices from the DOM, the DOM
// had them, and the screen was empty. A unit test cannot see opacity, and this
// file does not pretend otherwise.

describe('priceFor', () => {
  it('returns the monthly price in monthly mode', () => {
    const pro = INVESTOR_PLANS.find((p) => p.tier === 'pro_scout')!;
    expect(priceFor(pro, 'monthly')).toBe(pro.monthlyEur);
    expect(priceFor(pro, 'monthly')).toBe(130);
  });

  it('returns the per-month annual price in annual mode', () => {
    const pro = INVESTOR_PLANS.find((p) => p.tier === 'pro_scout')!;
    expect(priceFor(pro, 'annual')).toBe(pro.annualPerMonthEur);
    expect(priceFor(pro, 'annual')).toBe(100);
  });

  it('changes the displayed number for every priced tier when the toggle flips', () => {
    // The reported symptom was "a toggle that toggles nothing visible". This
    // asserts the toggle has something to change on each card.
    for (const p of INVESTOR_PLANS) {
      expect(priceFor(p, 'monthly')).not.toBe(priceFor(p, 'annual'));
    }
  });

  it('annual is never more expensive per month than monthly', () => {
    for (const p of INVESTOR_PLANS) {
      expect(priceFor(p, 'annual')).toBeLessThan(priceFor(p, 'monthly'));
    }
  });
});

describe('INVESTOR_PLANS — what the grid must render', () => {
  it('carries the three tier names the guest page has to show', () => {
    expect(INVESTOR_PLANS.map((p) => p.name))
      .toEqual(['Pro Scout', 'Ace Spotter', 'The Legendary Sleuth']);
  });

  it('every tier has the fields the card reads, so no card can render blank', () => {
    for (const p of INVESTOR_PLANS) {
      expect(p.name).toBeTruthy();
      expect(p.tagline).toBeTruthy();
      expect(typeof p.monthlyEur).toBe('number');
      expect(typeof p.annualPerMonthEur).toBe('number');
      expect(typeof p.annualEur).toBe('number');
      expect(p.bullets.length).toBeGreaterThan(0);
    }
  });

  it.each(['monthly', 'annual'] as BillingMode[])(
    'produces a positive price for every tier in %s mode', (mode) => {
      for (const p of INVESTOR_PLANS) expect(priceFor(p, mode)).toBeGreaterThan(0);
    },
  );
});
