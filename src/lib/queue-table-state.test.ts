import { describe, expect, it } from 'vitest';
import {
  parseQueueTableState, serializeQueueTableState, nextStateFor,
  rangeLabel, pageCount, toggleSort, DEFAULT_PAGE_SIZE,
} from './queue-table-state';

const P = (qs: string) => parseQueueTableState(new URLSearchParams(qs));

describe('parseQueueTableState', () => {
  it('an empty URL is the default view: page 1, undecided only, internal hidden', () => {
    expect(P('')).toEqual({
      page: 1, pageSize: DEFAULT_PAGE_SIZE, sort: null, dir: 'desc',
      showResolved: false, hideInternal: true, filters: {},
    });
  });

  it('reads a full URL back', () => {
    const s = P('page=3&size=100&sort=name&dir=asc&resolved=show&internal=shown&grade=A');
    expect(s).toEqual({
      page: 3, pageSize: 100, sort: 'name', dir: 'asc',
      showResolved: true, hideInternal: false, filters: { grade: 'A' },
    });
  });

  it('degrades a hand-edited URL instead of showing an empty table', () => {
    // Someone types page=0, size=7, dir=sideways.
    const s = P('page=0&size=7&dir=sideways');
    expect(s.page).toBe(1);
    expect(s.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(s.dir).toBe('desc');
    expect(P('page=-4').page).toBe(1);
  });

  it('drops a sort key the table does not have', () => {
    // A stale link from before a column was renamed must not sort by nothing.
    expect(parseQueueTableState(new URLSearchParams('sort=ghost'), { sortableKeys: ['name'] }).sort).toBeNull();
    expect(parseQueueTableState(new URLSearchParams('sort=name'), { sortableKeys: ['name'] }).sort).toBe('name');
  });

  it('never treats tab or its own keys as a filter', () => {
    expect(P('tab=candidates&page=2&grade=A').filters).toEqual({ grade: 'A' });
  });
});

describe('serializeQueueTableState', () => {
  it('writes nothing for the default view', () => {
    expect(serializeQueueTableState(P('')).toString()).toBe('');
  });

  it('round-trips a non-default view', () => {
    const s = P('page=3&size=100&sort=name&dir=asc&resolved=show&internal=shown&grade=A');
    expect(P(serializeQueueTableState(s).toString())).toEqual(s);
  });

  it('keeps ?tab= so the queue route still works', () => {
    const out = serializeQueueTableState({ page: 2 }, new URLSearchParams('tab=candidates&page=1'));
    expect(out.get('tab')).toBe('candidates');
    expect(out.get('page')).toBe('2');
  });
});

describe('nextStateFor', () => {
  it('filtering from page 4 returns to page 1', () => {
    // Otherwise the reader filters and sees an empty table, which reads as a bug.
    const s = { ...P(''), page: 4 };
    expect(nextStateFor(s, { filters: { grade: 'A' } }).page).toBe(1);
    expect(nextStateFor(s, { sort: 'name' }).page).toBe(1);
    expect(nextStateFor(s, { hideInternal: false }).page).toBe(1);
    expect(nextStateFor(s, { pageSize: 100 }).page).toBe(1);
  });

  it('paging does not reset the page', () => {
    expect(nextStateFor({ ...P(''), page: 4 }, { page: 5 }).page).toBe(5);
  });
});

describe('rangeLabel / pageCount / toggleSort', () => {
  it('counts honestly, including the last partial page and the empty case', () => {
    expect(rangeLabel(P(''), 751)).toBe('Showing 1–25 of 751');
    expect(rangeLabel({ ...P(''), page: 31 }, 751)).toBe('Showing 751–751 of 751');
    expect(rangeLabel(P(''), 0)).toBe('Nothing to show');
    expect(pageCount(751, 25)).toBe(31);
    expect(pageCount(0, 25)).toBe(1);
  });

  it('clicking the sorted column flips it; another column switches to it', () => {
    const s = P('sort=name&dir=desc');
    expect(toggleSort(s, 'name')).toEqual({ sort: 'name', dir: 'asc' });
    expect(toggleSort({ ...s, dir: 'asc' }, 'name')).toEqual({ sort: 'name', dir: 'desc' });
    expect(toggleSort(s, 'added')).toEqual({ sort: 'added', dir: 'desc' });
  });

  // Fase 3 — Startups/Investors adopted this desc-first rule unconditionally
  // when they moved their sort state here, regressing their own text
  // columns (Org, Plan, Stage), which used to start ascending under
  // table-sort.ts's nextSort. The rule now reads the column's type.
  it('a NEW column starts ascending when its type is text', () => {
    const s = P('');
    expect(toggleSort(s, 'name', 'text')).toEqual({ sort: 'name', dir: 'asc' });
  });
  it('a NEW column starts descending when its type is number or date', () => {
    const s = P('');
    expect(toggleSort(s, 'createdAt', 'date')).toEqual({ sort: 'createdAt', dir: 'desc' });
    expect(toggleSort(s, 'completenessPct', 'number')).toEqual({ sort: 'completenessPct', dir: 'desc' });
  });
  it('omitting the type keeps the Queue\'s own existing desc-first behavior unchanged', () => {
    const s = P('');
    expect(toggleSort(s, 'added')).toEqual({ sort: 'added', dir: 'desc' });
  });
  it('the type only decides the FIRST click — flipping an already-sorted column ignores it', () => {
    const s = P('sort=name&dir=asc');
    expect(toggleSort(s, 'name', 'text')).toEqual({ sort: 'name', dir: 'desc' });
    const d = P('sort=createdAt&dir=desc');
    expect(toggleSort(d, 'createdAt', 'date')).toEqual({ sort: 'createdAt', dir: 'asc' });
  });
});
