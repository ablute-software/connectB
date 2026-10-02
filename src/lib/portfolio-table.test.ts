import { describe, expect, it } from 'vitest';
import {
  PORTFOLIO_PAGE_SIZE, clampPage, emptyStateText, pageSlice, parsePageParam, portfolioColumns, viewAfter,
} from './portfolio-table';

describe('portfolioColumns — Prompt AL758 §A', () => {
  it('Current has its own columns, with no exit columns', () => {
    expect(portfolioColumns('current').map((c) => c.label)).toEqual([
      'Company', 'Website', 'Geography', 'Stage at entry', 'Sectors', 'Ticket', 'Instrument', 'Invested on', 'Contact',
    ]);
  });

  it('Past adds Exit date and Exit type as two SEPARATE columns, between Invested on and Contact', () => {
    const labels = portfolioColumns('past').map((c) => c.label);
    expect(labels).toEqual([
      'Company', 'Website', 'Geography', 'Stage at entry', 'Sectors', 'Ticket', 'Instrument', 'Invested on',
      'Exit date', 'Exit type', 'Contact',
    ]);
  });
});

describe('emptyStateText — Prompt AL758 §A', () => {
  it('names the tab and points at both ways to fill it', () => {
    expect(emptyStateText('current')).toBe('No current companies yet. Add one manually, or import a CSV/Excel using the template.');
    expect(emptyStateText('past')).toBe('No past companies yet. Add one manually, or import a CSV/Excel using the template.');
  });
});

describe('paging — Prompt AL758 §B', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

  it('is 20 per page (the pipeline stays at 25 — a separate constant)', () => {
    expect(PORTFOLIO_PAGE_SIZE).toBe(20);
  });

  it('45 rows are 3 pages of 20 / 20 / 5', () => {
    const all = rows(45);
    expect(pageSlice(all, 1)).toHaveLength(20);
    expect(pageSlice(all, 2)).toHaveLength(20);
    expect(pageSlice(all, 3)).toHaveLength(5);
    expect(pageSlice(all, 3)[0]).toBe(41);
  });

  it('?page=2 opens the second page', () => {
    expect(pageSlice(rows(45), parsePageParam('2'))[0]).toBe(21);
  });

  it('a page that does not exist falls back to the nearest real one, never an empty table', () => {
    expect(clampPage(9, 45)).toBe(3);
    expect(clampPage(0, 45)).toBe(1);
    expect(clampPage(5, 0)).toBe(1);
    expect(pageSlice(rows(45), 9)).toHaveLength(5);
  });

  it('a hand-edited or junk ?page= degrades to page 1', () => {
    expect(parsePageParam(null)).toBe(1);
    expect(parsePageParam('abc')).toBe(1);
    expect(parsePageParam('-3')).toBe(1);
    expect(parsePageParam('2.7')).toBe(2);
  });

  it('exactly 20 rows is one page, 21 is two', () => {
    expect(clampPage(2, 20)).toBe(1);
    expect(clampPage(2, 21)).toBe(2);
  });
});

describe('viewAfter — where the investor lands after the list changes', () => {
  it('switching tab always goes to page 1 of the other tab', () => {
    expect(viewAfter({ tab: 'current', page: 3 }, { type: 'switch-tab', tab: 'past' })).toEqual({ tab: 'past', page: 1 });
  });

  it('removing the only row on page 3 steps back to page 2', () => {
    // 41 rows -> page 3 holds 1. After removing it there are 40 -> 2 pages.
    expect(viewAfter({ tab: 'current', page: 3 }, { type: 'removed' }, 40)).toEqual({ tab: 'current', page: 2 });
  });

  it('removing a row that leaves the page non-empty stays on that page', () => {
    expect(viewAfter({ tab: 'current', page: 2 }, { type: 'removed' }, 39)).toEqual({ tab: 'current', page: 2 });
  });

  it('adding while on page 3 goes to page 1, where the newest row is', () => {
    expect(viewAfter({ tab: 'current', page: 3 }, { type: 'added' })).toEqual({ tab: 'current', page: 1 });
  });

  it('an import moves to the tab the rows landed in, page 1', () => {
    expect(viewAfter({ tab: 'current', page: 3 }, { type: 'imported', landedIn: 'past' })).toEqual({ tab: 'past', page: 1 });
    expect(viewAfter({ tab: 'past', page: 2 }, { type: 'imported' })).toEqual({ tab: 'past', page: 1 });
  });

  it('editing stays where the investor was', () => {
    expect(viewAfter({ tab: 'past', page: 2 }, { type: 'edited' })).toEqual({ tab: 'past', page: 2 });
  });
});
