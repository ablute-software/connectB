import { describe, expect, it } from 'vitest';
import { formatPeriod } from './period-format';

describe('formatPeriod', () => {
  it('year precision shows only the year, both ends', () => {
    expect(formatPeriod({
      periodFrom: '2009-07-01', periodFromPrecision: 'year',
      periodTo: '2015-07-01', periodToPrecision: 'year',
    })).toBe('2009 – 2015');
  });

  it('month precision shows month name + year', () => {
    expect(formatPeriod({
      periodFrom: '2024-09-01', periodFromPrecision: 'month',
      periodTo: '2025-08-01', periodToPrecision: 'month',
    })).toBe('Sep 2024 – Aug 2025');
  });

  it('is_current renders "present" for the end, ignoring any period_to', () => {
    expect(formatPeriod({
      periodFrom: '2026-01-01', periodFromPrecision: 'year', periodIsCurrent: true,
    })).toBe('2026 – present');
  });

  it('a from date with no to date and not current shows just the from', () => {
    expect(formatPeriod({ periodFrom: '1998-01-01', periodFromPrecision: 'year' })).toBe('1998');
  });

  it('exact_day shows the full stored date', () => {
    expect(formatPeriod({
      periodFrom: '2024-03-15', periodFromPrecision: 'exact_day',
      periodTo: '2024-03-15', periodToPrecision: 'exact_day',
    })).toBe('2024-03-15 – 2024-03-15');
  });

  it('approximate precision is qualified, never shown as a bare exact date', () => {
    expect(formatPeriod({ periodFrom: '2010-01-01', periodFromPrecision: 'approximate' })).toBe('c. 2010');
  });

  it('nothing at all (the real Marco Neves "current PV role" case — no dates captured) returns null', () => {
    expect(formatPeriod({})).toBeNull();
    expect(formatPeriod({ periodIsCurrent: false })).toBeNull();
  });
});
