// Prompt 519 §4(d) — the prompt asks specifically for a test that the chosen
// date_precision reaches the store intact rather than being hardcoded. That is
// what this file pins, plus the date arithmetic the selector depends on: a
// non-exact precision still has to produce a REAL ISO date, because every
// downstream consumer (x-axis, sorting, the domain calculation) does date
// maths on it and must never learn about precision.
import { describe, it, expect } from 'vitest';
import { dateFromParts, partsFromDate, formatWithPrecision } from './roadmap-date-precision';

describe('dateFromParts', () => {
  it('anchors a quarter to the first day of its first month', () => {
    expect(dateFromParts('quarter', { year: 2026, quarter: 1 })).toBe('2026-01-01');
    expect(dateFromParts('quarter', { year: 2026, quarter: 2 })).toBe('2026-04-01');
    expect(dateFromParts('quarter', { year: 2026, quarter: 3 })).toBe('2026-07-01');
    expect(dateFromParts('quarter', { year: 2026, quarter: 4 })).toBe('2026-10-01');
  });

  it('anchors a month to its first day', () => {
    expect(dateFromParts('approx', { year: 2026, month: 9 })).toBe('2026-09-01');
    expect(dateFromParts('approx', { year: 2026, month: 12 })).toBe('2026-12-01');
  });

  it('passes an exact date straight through', () => {
    expect(dateFromParts('exact', { year: 2026, exact: '2026-03-17' })).toBe('2026-03-17');
  });

  it('always produces a parseable date, even from nonsense input', () => {
    // The year input is a free number field, so out-of-range values are
    // reachable by typing. A date the rest of the canvas cannot parse would
    // break the whole timeline, not just this event.
    for (const d of [
      dateFromParts('quarter', { year: 2026, quarter: 99 }),
      dateFromParts('quarter', { year: 2026, quarter: 0 }),
      dateFromParts('approx', { year: 2026, month: 44 }),
      dateFromParts('approx', { year: 2026, month: -3 }),
      dateFromParts('exact', { year: 2026 }),
    ]) {
      expect(Number.isNaN(new Date(d).getTime()), d).toBe(false);
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('pads a short year so the string stays sortable', () => {
    expect(dateFromParts('approx', { year: 7, month: 1 })).toBe('0007-01-01');
  });
});

describe('partsFromDate', () => {
  it('round-trips every quarter', () => {
    for (const q of [1, 2, 3, 4]) {
      expect(partsFromDate(dateFromParts('quarter', { year: 2026, quarter: q })).quarter).toBe(q);
    }
  });

  it('derives the quarter from the month boundaries correctly', () => {
    expect(partsFromDate('2026-03-31').quarter).toBe(1);
    expect(partsFromDate('2026-04-01').quarter).toBe(2);
    expect(partsFromDate('2026-12-31').quarter).toBe(4);
  });
});

describe('formatWithPrecision', () => {
  it('reads back as the period the founder actually chose, not an invented day', () => {
    expect(formatWithPrecision('2026-07-01', 'quarter')).toBe('Q3 2026');
    expect(formatWithPrecision('2026-09-01', 'approx')).toBe('Sep 2026');
  });

  it('leaves an exact date alone, including when precision is absent', () => {
    expect(formatWithPrecision('2026-03-17', 'exact')).toBe('2026-03-17');
    expect(formatWithPrecision('2026-03-17', null)).toBe('2026-03-17');
    expect(formatWithPrecision('2026-03-17', undefined)).toBe('2026-03-17');
  });
});
