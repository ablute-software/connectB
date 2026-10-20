import { describe, expect, it } from 'vitest';
import {
  factZone, factSummaryLine, groupIncompleteByMarket, incompleteZoneSummary,
  missingFieldsLabel, NO_MARKET_STATED_LABEL, type FactView,
} from './market-facts-view';
import { underDefaultLocale } from '@/test/default-locale';

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

// The copy around the number is English; the machine's language must not decide how the number is grouped. A bare toLocaleString() printed "6 000 000 000" on a
// pt-PT machine (this module's own test above failed there on every full run, and a pt-PT reader's browser showed the same), so the DEFAULT locale is stubbed here:
// the assertions hold on any machine, and a bare call comes back red everywhere instead of only where the developer happens to live.
describe('factSummaryLine — numbers are grouped the same way whatever the machine\'s language', () => {
  const marketSize = (shape: 'point' | 'interval' | 'lower_bound', over: Record<string, number | null> = {}) => factSummaryLine({
    factType: 'market_size',
    payload: { marketDefinition: 'Digital health', geography: 'EU', metric: 'TAM', estimateShape: shape, value: 6_000_000_000, lowerBound: null, upperBound: null, currency: 'EUR', asOfYear: 2026, ...over },
  });

  it('the stub is real: on those machines a bare toLocaleString() does NOT print 6,000,000,000 (so a bare call in the formatter would be caught)', () => {
    for (const locale of ['pt-PT', 'de-DE', 'fr-FR']) {
      expect(underDefaultLocale(locale, () => (6_000_000_000).toLocaleString()), locale).not.toBe('6,000,000,000');
    }
  });

  it.each(['pt-PT', 'de-DE', 'fr-FR'])('on a %s machine a point estimate still reads 6,000,000,000', (locale) => {
    expect(underDefaultLocale(locale, () => marketSize('point'))).toBe('Market size EUR 6,000,000,000 TAM · Digital health · EU · 2026');
  });

  it.each(['pt-PT', 'de-DE', 'fr-FR'])('on a %s machine an interval and a bound group their thousands the same way', (locale) => {
    expect(underDefaultLocale(locale, () => marketSize('interval', { value: null, lowerBound: 1_500_000, upperBound: 2_500_000 })))
      .toBe('Market size EUR 1,500,000–2,500,000 TAM · Digital health · EU · 2026');
    expect(underDefaultLocale(locale, () => marketSize('lower_bound', { value: null, lowerBound: 12_000 })))
      .toBe('Market size EUR ≥12,000 TAM · Digital health · EU · 2026');
  });

  it('numbers below a thousand are untouched, on any machine', () => {
    expect(underDefaultLocale('de-DE', () => marketSize('point', { value: 950 }))).toBe('Market size EUR 950 TAM · Digital health · EU · 2026');
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

// ---------------------------------------------------------------------------
// Prompt 496 — the Incomplete zone's grouping. The card itself cannot be
// rendered in a test here (no jsdom, no @testing-library, no JSX transform
// for vitest), so the whole decision the component makes lives in these two
// pure functions and is pinned here.

function incompleteOf(marketDefinition: string | null, id: string) {
  return { id, payload: { marketDefinition } };
}

describe('groupIncompleteByMarket — Prompt 496', () => {
  it('groups the real ablute_ shape and orders biggest market first', () => {
    // The four largest groups measured in production 31/08: biosensors 12,
    // Biosensors Market 11, point-of-care urinalysis 11, Urinalysis Market 8.
    const facts = [
      ...Array.from({ length: 8 }, (_, i) => incompleteOf('Urinalysis Market', `u${i}`)),
      ...Array.from({ length: 12 }, (_, i) => incompleteOf('biosensors', `b${i}`)),
      ...Array.from({ length: 11 }, (_, i) => incompleteOf('point-of-care urinalysis', `p${i}`)),
    ];
    const groups = groupIncompleteByMarket(facts);

    expect(groups.map((g) => [g.label, g.facts.length])).toEqual([
      ['biosensors', 12],
      ['point-of-care urinalysis', 11],
      ['Urinalysis Market', 8],
    ]);
    // Nothing is dropped by grouping — every fact still reachable.
    expect(groups.reduce((n, g) => n + g.facts.length, 0)).toBe(facts.length);
  });

  it('EXACT string equality only — a one-letter case difference stays two groups', () => {
    // Not hypothetical: these two strings both exist in production, two rows
    // each, differing only in the leading capital. Folding them would be a
    // merge with no positive proof (invariable 14), and the fact that it
    // looks obviously right to a human is exactly why the code must not
    // decide it. Bloco 5's job, with evidence.
    const groups = groupIncompleteByMarket([
      incompleteOf('combined addressable opportunity across point-of-care urinalysis and biosensors', 'a'),
      incompleteOf('Combined addressable opportunity across point-of-care urinalysis and biosensors', 'b'),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('never groups on similarity either — biosensors and Biosensors Market stay apart', () => {
    const groups = groupIncompleteByMarket([
      incompleteOf('biosensors', 'a'),
      incompleteOf('Biosensors Market', 'b'),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('a fact with no market at all gets an honest label, not the string "null"', () => {
    const groups = groupIncompleteByMarket([incompleteOf(null, 'a'), incompleteOf(undefined as unknown as null, 'b')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].marketDefinition).toBeNull();
    expect(groups[0].label).toBe(NO_MARKET_STATED_LABEL);
  });

  it('a market literally named "null" is not the same as no market', () => {
    const groups = groupIncompleteByMarket([incompleteOf('null', 'a'), incompleteOf(null, 'b')]);
    expect(groups).toHaveLength(2);
  });

  it('ties break by label, so the order is stable across renders', () => {
    const groups = groupIncompleteByMarket([
      incompleteOf('smart toilet', 'a'),
      incompleteOf('corporate wellness', 'b'),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['corporate wellness', 'smart toilet']);
  });

  it('is empty for no facts — the zone renders nothing at all', () => {
    expect(groupIncompleteByMarket([])).toEqual([]);
  });
});

describe('incompleteZoneSummary — Prompt 496', () => {
  it('states scale and structure, and claims nothing about content', () => {
    // The real numbers this shipped against.
    expect(incompleteZoneSummary(68, 16)).toBe('68 items across 16 markets');
  });

  it('agrees with itself in the singular, both halves independently', () => {
    expect(incompleteZoneSummary(1, 1)).toBe('1 item across 1 market');
    expect(incompleteZoneSummary(3, 1)).toBe('3 items across 1 market');
    expect(incompleteZoneSummary(1, 1)).not.toContain('items');
  });
});
