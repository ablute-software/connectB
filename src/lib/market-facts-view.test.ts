import { describe, expect, it } from 'vitest';
import { factZone, factSummaryLine, missingFieldsLabel, type FactView } from './market-facts-view';

function fact(overrides: Partial<Pick<FactView, 'validationStatus' | 'verificationStatus'>> = {}) {
  return { validationStatus: 'valid' as const, verificationStatus: 'founder_reported' as const, ...overrides };
}

// The precedence this whole prompt hangs on: validation_status is checked
// FIRST and can only ever demote a fact away from "actionable" —
// verification_status alone can never make a malformed/incomplete fact
// look like verified market intelligence.
describe('factZone — the §D precedence table', () => {
  it('a valid, founder_reported fact is the "founder-reported · unverified" zone, never actionable', () => {
    expect(factZone(fact({ validationStatus: 'valid', verificationStatus: 'founder_reported' }))).toBe('founder_reported');
  });

  it('a valid fact with externally_sourced or corroborated evidence is actionable', () => {
    expect(factZone(fact({ validationStatus: 'valid', verificationStatus: 'externally_sourced' }))).toBe('actionable');
    expect(factZone(fact({ validationStatus: 'valid', verificationStatus: 'corroborated' }))).toBe('actionable');
  });

  it('an incomplete fact is the incomplete zone regardless of verification_status', () => {
    expect(factZone(fact({ validationStatus: 'incomplete', verificationStatus: 'founder_reported' }))).toBe('incomplete');
    expect(factZone(fact({ validationStatus: 'incomplete', verificationStatus: 'corroborated' }))).toBe('incomplete');
  });

  it('an invalid fact is audit-only regardless of verification_status — never actionable even if "corroborated"', () => {
    expect(factZone(fact({ validationStatus: 'invalid', verificationStatus: 'founder_reported' }))).toBe('invalid');
    expect(factZone(fact({ validationStatus: 'invalid', verificationStatus: 'corroborated' }))).toBe('invalid');
  });
});

describe('factSummaryLine', () => {
  it('renders an interval growth fact with market/geography/period, matching §D\'s own example', () => {
    const line = factSummaryLine({
      factType: 'growth',
      payload: {
        marketDefinition: 'Home diagnostics', geography: 'EU', metric: 'CAGR',
        estimateShape: 'interval', value: null, lowerBound: 8, upperBound: 9.5,
        periodStart: 2025, periodEnd: 2030,
      },
    });
    expect(line).toBe('Growth 8–9.5% CAGR · Home diagnostics · EU · 2025–2030');
  });

  it('never states context the payload does not actually carry', () => {
    const line = factSummaryLine({
      factType: 'growth',
      payload: { marketDefinition: null, geography: null, metric: 'other', estimateShape: 'point', value: 8, lowerBound: null, upperBound: null },
    });
    expect(line).toBe('Growth 8%');
  });

  it('renders a market_size point fact with currency', () => {
    const line = factSummaryLine({
      factType: 'market_size',
      payload: { marketDefinition: 'Digital health', geography: null, metric: 'TAM', estimateShape: 'point', value: 6_000_000_000, lowerBound: null, upperBound: null, currency: 'EUR', asOfYear: 2026 },
    });
    expect(line).toBe('Market size EUR 6,000,000,000 TAM · Digital health · 2026');
  });

  it('renders a lower_bound-only growth fact with the ≥ prefix, never inventing an upper bound', () => {
    const line = factSummaryLine({
      factType: 'growth',
      payload: { marketDefinition: null, geography: null, metric: 'CAGR', estimateShape: 'lower_bound', value: null, lowerBound: 8, upperBound: null },
    });
    expect(line).toBe('Growth ≥8% CAGR');
  });
});

describe('missingFieldsLabel', () => {
  it('formats one missing field', () => {
    expect(missingFieldsLabel(['geography'])).toBe('geography missing');
  });

  it('formats several missing fields with an Oxford-free "and"', () => {
    expect(missingFieldsLabel(['marketDefinition', 'geography', 'period'])).toBe('market, geography and period missing');
  });

  it('falls back to the raw key for an unmapped field rather than dropping it silently', () => {
    expect(missingFieldsLabel(['someNewField'])).toBe('someNewField missing');
  });
});
