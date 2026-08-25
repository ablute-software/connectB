import { describe, expect, it } from 'vitest';
import { isStale, marketDataGaps, freshnessReport } from './market-data-gaps';

const NOW = new Date('2026-08-25T00:00:00Z');

describe('isStale — mais de 12 meses fica "a envelhecer"', () => {
  it('uma data recente não é stale', () => {
    expect(isStale('2026-06-01', NOW)).toBe(false);
  });
  it('uma data de há 13 meses é stale', () => {
    expect(isStale('2025-07-01', NOW)).toBe(true);
  });
  it('sem data, nunca é stale (não há o que envelhecer)', () => {
    expect(isStale(null, NOW)).toBe(false);
  });
});

describe('marketDataGaps — regras mecânicas da lente do investidor', () => {
  it('sizing só top-down/report dispara o aviso; com bottom-up presente, não', () => {
    const onlyTopDown = marketDataGaps([{ sizeMethod: 'top_down', sizeValueEur: 100 }], []);
    expect(onlyTopDown.some((g) => g.rule === 'no_bottom_up_sizing')).toBe(true);

    const withBottomUp = marketDataGaps([{ sizeMethod: 'bottom_up', sizeValueEur: 100 }, { sizeMethod: 'top_down', sizeValueEur: 200 }], []);
    expect(withBottomUp.some((g) => g.rule === 'no_bottom_up_sizing')).toBe(false);
  });

  it('sem NENHUM anel com número, não pede bottom-up (nada para comparar ainda)', () => {
    const gaps = marketDataGaps([{ sizeMethod: null, sizeValueEur: null }], []);
    expect(gaps.some((g) => g.rule === 'no_bottom_up_sizing')).toBe(false);
  });

  it('lista de concorrentes sem incumbente dispara o aviso', () => {
    const gaps = marketDataGaps([], [{ companyType: 'startup', hasFundingData: true }]);
    expect(gaps.some((g) => g.rule === 'no_incumbent')).toBe(true);
  });

  it('com um incumbente presente, não dispara', () => {
    const gaps = marketDataGaps([], [{ companyType: 'incumbent', hasFundingData: true }]);
    expect(gaps.some((g) => g.rule === 'no_incumbent')).toBe(false);
  });

  it('nenhum concorrente com financiamento conhecido dispara o aviso', () => {
    const gaps = marketDataGaps([], [{ companyType: 'startup', hasFundingData: false }]);
    expect(gaps.some((g) => g.rule === 'no_competitor_funding')).toBe(true);
  });

  it('sem concorrentes nenhuns, nenhuma das regras de concorrente dispara', () => {
    const gaps = marketDataGaps([], []);
    expect(gaps.some((g) => g.rule === 'no_incumbent' || g.rule === 'no_competitor_funding')).toBe(false);
  });
});

describe('freshnessReport', () => {
  it('marca cada item independentemente', () => {
    const report = freshnessReport([
      { label: 'Beachhead sizing', sourceOrUpdatedAt: '2026-08-01' },
      { label: 'Category sizing', sourceOrUpdatedAt: '2024-01-01' },
    ], NOW);
    expect(report.find((r) => r.label === 'Beachhead sizing')?.stale).toBe(false);
    expect(report.find((r) => r.label === 'Category sizing')?.stale).toBe(true);
  });
});
