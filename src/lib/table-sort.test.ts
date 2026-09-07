import { describe, expect, it } from 'vitest';
import { compareCells, nextSort, sortRows, sortIndicator } from './table-sort';

describe('compareCells', () => {
  it('orders strings, numbers and booleans', () => {
    expect(compareCells('a', 'b')).toBeLessThan(0);
    expect(compareCells(2, 10)).toBeLessThan(0);      // numeric, not lexical
    expect(compareCells(false, true)).toBeLessThan(0);
  });

  it('puts nulls after everything, in both directions', () => {
    expect(compareCells(null, 'a')).toBeGreaterThan(0);
    expect(compareCells('a', null)).toBeLessThan(0);
    expect(compareCells(null, null)).toBe(0);
    expect(compareCells(undefined, 5)).toBeGreaterThan(0);
  });

  it('returns 0 for types it cannot order rather than guessing', () => {
    expect(compareCells({ a: 1 }, { b: 2 })).toBe(0);
    expect(compareCells('a', 5)).toBe(0);
  });
});

describe('nextSort', () => {
  it('a new column starts ascending; the same column flips', () => {
    expect(nextSort({ key: 'name', dir: 'asc' }, 'plan')).toEqual({ key: 'plan', dir: 'asc' });
    expect(nextSort({ key: 'name', dir: 'asc' }, 'name')).toEqual({ key: 'name', dir: 'desc' });
    expect(nextSort({ key: 'name', dir: 'desc' }, 'name')).toEqual({ key: 'name', dir: 'asc' });
  });
});

describe('sortRows', () => {
  const rows = [
    { name: 'Beta', seats: 3, lastLogin: null },
    { name: 'Alpha', seats: 10, lastLogin: '2026-09-01' },
    { name: 'Gamma', seats: null, lastLogin: '2026-08-01' },
  ];

  it('sorts ascending and descending without mutating the input', () => {
    const before = [...rows];
    expect(sortRows(rows, 'name', 'asc').map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
    expect(sortRows(rows, 'name', 'desc').map((r) => r.name)).toEqual(['Gamma', 'Beta', 'Alpha']);
    expect(rows).toEqual(before);
  });

  it('keeps blanks at the bottom when the direction flips', () => {
    // The reason this is tested rather than assumed: reversing a comparator
    // that puts nulls last would put them first, and a descending column would
    // open on a wall of blanks.
    expect(sortRows(rows, 'seats', 'asc').map((r) => r.seats)).toEqual([3, 10, null]);
    expect(sortRows(rows, 'seats', 'desc').map((r) => r.seats)).toEqual([10, 3, null]);
    expect(sortRows(rows, 'lastLogin', 'desc').map((r) => r.lastLogin))
      .toEqual(['2026-09-01', '2026-08-01', null]);
  });

  it('sorts numbers numerically, not as text', () => {
    const n = [{ v: 9 }, { v: 10 }, { v: 100 }];
    expect(sortRows(n, 'v', 'asc').map((r) => r.v)).toEqual([9, 10, 100]);
  });

  it('accepts a getter for values that are not plain fields', () => {
    const withGetter = sortRows(rows, 'seats', 'asc', (r, k) => (k === 'seats' ? -(r.seats ?? 0) : null));
    expect(withGetter.map((r) => r.name)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });
});

describe('sortIndicator', () => {
  it('marks only the active column', () => {
    expect(sortIndicator(true, 'asc')).toBe('▲');
    expect(sortIndicator(true, 'desc')).toBe('▼');
    expect(sortIndicator(false, 'asc')).toBe('');
  });
});
