import { describe, expect, it } from 'vitest';
import { periodHasPassed, periodLabel, quarterSortKey, sortRoadmapPeriods } from './roadmap';

describe('quarterSortKey', () => {
  it('year is 0 — sorts before any quarter in the same year', () => {
    expect(quarterSortKey('year')).toBe(0);
  });
  it('quarter returns its own number', () => {
    expect(quarterSortKey('quarter', 3)).toBe(3);
  });
});

describe('sortRoadmapPeriods', () => {
  it('orders by year first', () => {
    const periods = [
      { period_kind: 'year' as const, period_year: 2027 },
      { period_kind: 'year' as const, period_year: 2024 },
    ];
    expect(sortRoadmapPeriods(periods).map((p) => p.period_year)).toEqual([2024, 2027]);
  });

  it('within the same year, the whole-year milestone sorts before its quarters', () => {
    const periods = [
      { period_kind: 'quarter' as const, period_year: 2025, period_quarter: 2 },
      { period_kind: 'year' as const, period_year: 2025 },
      { period_kind: 'quarter' as const, period_year: 2025, period_quarter: 1 },
    ];
    const sorted = sortRoadmapPeriods(periods);
    expect(sorted.map((p) => (p.period_kind === 'year' ? 'year' : `Q${p.period_quarter}`))).toEqual(['year', 'Q1', 'Q2']);
  });

  it('does not mutate the input array', () => {
    const periods = [{ period_kind: 'year' as const, period_year: 2027 }, { period_kind: 'year' as const, period_year: 2024 }];
    const copy = [...periods];
    sortRoadmapPeriods(periods);
    expect(periods).toEqual(copy);
  });
});

describe('periodLabel', () => {
  it('year — just the number', () => {
    expect(periodLabel('year', 2026)).toBe('2026');
  });
  it('quarter — "Q{n} {year}"', () => {
    expect(periodLabel('quarter', 2025, 2)).toBe('Q2 2025');
  });
});

describe('periodHasPassed', () => {
  const now = new Date('2026-08-11T12:00:00Z');

  it('a past year has passed', () => {
    expect(periodHasPassed({ period_kind: 'year', period_year: 2024 }, now)).toBe(true);
  });
  it('a future year has not passed', () => {
    expect(periodHasPassed({ period_kind: 'year', period_year: 2027 }, now)).toBe(false);
  });
  it('the current year (not yet Dec 31) has not passed', () => {
    expect(periodHasPassed({ period_kind: 'year', period_year: 2026 }, now)).toBe(false);
  });
  it('Q2 2025 (ended June 30 2025) has passed', () => {
    expect(periodHasPassed({ period_kind: 'quarter', period_year: 2025, period_quarter: 2 }, now)).toBe(true);
  });
  it('Q3 2026 (ends Sep 30 2026) has not passed yet on Aug 11 2026', () => {
    expect(periodHasPassed({ period_kind: 'quarter', period_year: 2026, period_quarter: 3 }, now)).toBe(false);
  });
  it('Q4 2027 has not passed', () => {
    expect(periodHasPassed({ period_kind: 'quarter', period_year: 2027, period_quarter: 4 }, now)).toBe(false);
  });
  it('the exact last instant of a quarter has NOT yet passed (< not <=)', () => {
    const endOfQ2 = new Date('2025-06-30T23:59:59.000Z');
    expect(periodHasPassed({ period_kind: 'quarter', period_year: 2025, period_quarter: 2 }, endOfQ2)).toBe(false);
  });
});
