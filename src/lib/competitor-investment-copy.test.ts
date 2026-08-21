import { describe, expect, it } from 'vitest';
import { competitorInvestmentSummary, type CompetitorInvestmentItem } from './competitor-investment-copy';

function item(overrides: Partial<CompetitorInvestmentItem> = {}): CompetitorInvestmentItem {
  return {
    entityId: 'e1', companyName: 'Withings', amountEur: 500000, investedAt: '2024-03-15',
    roundType: 'Series A', stillHeld: true, soldAt: null, soldAmountEur: null, confidence: 'high',
    ...overrides,
  };
}

describe('competitorInvestmentSummary', () => {
  it('renders amount, year, and still-held status', () => {
    expect(competitorInvestmentSummary(item())).toBe('Invested in Withings, €500k in 2024 — still holds the position');
  });

  it('renders a sold position with exit year and amount', () => {
    const s = competitorInvestmentSummary(item({ stillHeld: false, soldAt: '2025-06-01', soldAmountEur: 900000 }));
    expect(s).toBe('Invested in Withings, €500k in 2024 — sold in 2025 for €900k');
  });

  it('renders a sold position with no known exit details', () => {
    const s = competitorInvestmentSummary(item({ stillHeld: false, soldAt: null, soldAmountEur: null }));
    expect(s).toBe('Invested in Withings, €500k in 2024 — sold');
  });

  it('omits the status clause entirely when still_held is unknown', () => {
    const s = competitorInvestmentSummary(item({ stillHeld: null }));
    expect(s).toBe('Invested in Withings, €500k in 2024');
  });

  it('omits the amount when unknown, without leaving a stray space', () => {
    const s = competitorInvestmentSummary(item({ amountEur: null }));
    expect(s).toBe('Invested in Withings, in 2024 — still holds the position');
  });

  it('omits the year when invested_at is unknown', () => {
    const s = competitorInvestmentSummary(item({ investedAt: null }));
    expect(s).toBe('Invested in Withings, €500k — still holds the position');
  });

  it('falls back to a generic company label when the name is missing', () => {
    const s = competitorInvestmentSummary(item({ companyName: null }));
    expect(s).toBe('Invested in a company, €500k in 2024 — still holds the position');
  });

  it('never claims "declared competitor" — that depends on Fase 2 data this phase does not have', () => {
    expect(competitorInvestmentSummary(item())).not.toMatch(/competitor/i);
  });
});
