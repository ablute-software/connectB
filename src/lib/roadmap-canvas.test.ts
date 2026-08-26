import { describe, expect, it } from 'vitest';
import {
  xFromDate, dateFromX, snapToMonth, densityLevel, densityLevelForLane, clusterByProximity,
  zoomWindow, matchesTimeToggle, matchesCategoryVisibility, migrateMilestoneToEvents,
  derivedEventState, quarterLabel, quartersInRange,
  semesterLabel, semestersInRange, yearLabel, yearsInRange, headerGranularity,
} from './roadmap-canvas';

describe('derivedEventState — the three-state model the detail panel shows', () => {
  const now = new Date('2024-06-15T00:00:00Z');

  it('done is always completed, period or point', () => {
    expect(derivedEventState('done', '2024-01-01', null, now)).toBe('completed');
    expect(derivedEventState('done', '2024-01-01', '2024-12-01', now)).toBe('completed');
  });

  it('planned with no end date is planned, never in_progress', () => {
    expect(derivedEventState('planned', '2024-01-01', null, now)).toBe('planned');
  });

  it('planned with now inside [date, end_date] is in_progress', () => {
    expect(derivedEventState('planned', '2024-01-01', '2024-12-01', now)).toBe('in_progress');
  });

  it('planned with a period entirely in the future is planned, not in_progress', () => {
    expect(derivedEventState('planned', '2025-01-01', '2025-06-01', now)).toBe('planned');
  });

  it('planned with a period already fully past is still planned (never done implicitly)', () => {
    expect(derivedEventState('planned', '2023-01-01', '2023-06-01', now)).toBe('planned');
  });

  it('boundaries are inclusive', () => {
    expect(derivedEventState('planned', '2024-06-15', '2024-12-01', now)).toBe('in_progress');
    expect(derivedEventState('planned', '2024-01-01', '2024-06-15', now)).toBe('in_progress');
  });
});

describe('quarterLabel', () => {
  it('formats an ISO date as "Q<n> \'<yy>"', () => {
    expect(quarterLabel('2024-01-15')).toBe("Q1 '24");
    expect(quarterLabel('2024-04-01')).toBe("Q2 '24");
    expect(quarterLabel('2024-09-30')).toBe("Q3 '24");
    expect(quarterLabel('2024-12-31')).toBe("Q4 '24");
  });
});

describe('quartersInRange', () => {
  it('lists every quarter the window touches, in order', () => {
    const spans = quartersInRange(new Date('2023-11-15T00:00:00Z'), new Date('2024-04-10T00:00:00Z'));
    expect(spans.map((s) => s.label)).toEqual(["Q4 '23", "Q1 '24", "Q2 '24"]);
  });

  it('a window entirely inside one quarter still lists that quarter', () => {
    const spans = quartersInRange(new Date('2024-02-01T00:00:00Z'), new Date('2024-02-20T00:00:00Z'));
    expect(spans.map((s) => s.label)).toEqual(["Q1 '24"]);
  });

  it('a degenerate (empty) window produces no spans', () => {
    const d = new Date('2024-01-01T00:00:00Z');
    expect(quartersInRange(d, d)).toEqual([]);
  });

  it('each span\'s [start, end) actually bounds a calendar quarter', () => {
    const [q] = quartersInRange(new Date('2024-05-01T00:00:00Z'), new Date('2024-05-02T00:00:00Z'));
    expect(q.start.toISOString()).toBe('2024-04-01T00:00:00.000Z');
    expect(q.end.toISOString()).toBe('2024-07-01T00:00:00.000Z');
  });
});

describe('semesterLabel / semestersInRange', () => {
  it('formats an ISO date as "S<n> \'<yy>"', () => {
    expect(semesterLabel('2024-01-15')).toBe("S1 '24");
    expect(semesterLabel('2024-06-30')).toBe("S1 '24");
    expect(semesterLabel('2024-07-01')).toBe("S2 '24");
    expect(semesterLabel('2024-12-31')).toBe("S2 '24");
  });

  it('lists every semester the window touches, in order', () => {
    const spans = semestersInRange(new Date('2023-11-15T00:00:00Z'), new Date('2024-07-10T00:00:00Z'));
    expect(spans.map((s) => s.label)).toEqual(["S2 '23", "S1 '24", "S2 '24"]);
  });

  it('each span\'s [start, end) bounds a calendar semester', () => {
    const [s] = semestersInRange(new Date('2024-05-01T00:00:00Z'), new Date('2024-05-02T00:00:00Z'));
    expect(s.start.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(s.end.toISOString()).toBe('2024-07-01T00:00:00.000Z');
  });
});

describe('yearLabel / yearsInRange', () => {
  it('formats an ISO date as the full year', () => {
    expect(yearLabel('2024-01-15')).toBe('2024');
    expect(yearLabel('2027-12-31')).toBe('2027');
  });

  it('lists every year the window touches, in order', () => {
    const spans = yearsInRange(new Date('2019-06-01T00:00:00Z'), new Date('2022-02-01T00:00:00Z'));
    expect(spans.map((s) => s.label)).toEqual(['2019', '2020', '2021', '2022']);
  });

  it('each span\'s [start, end) bounds a calendar year', () => {
    const [y] = yearsInRange(new Date('2024-05-01T00:00:00Z'), new Date('2024-05-02T00:00:00Z'));
    expect(y.start.toISOString()).toBe('2024-01-01T00:00:00.000Z');
    expect(y.end.toISOString()).toBe('2025-01-01T00:00:00.000Z');
  });
});

describe('headerGranularity', () => {
  it('quarter when there is enough room per quarter', () => {
    expect(headerGranularity(56)).toBe('quarter');
    expect(headerGranularity(200)).toBe('quarter');
  });

  it('semester in the middle band', () => {
    expect(headerGranularity(55)).toBe('semester');
    expect(headerGranularity(28)).toBe('semester');
  });

  it('year when quarters would be too cramped even in pairs', () => {
    expect(headerGranularity(27)).toBe('year');
    expect(headerGranularity(1)).toBe('year');
  });
});

describe('xFromDate / dateFromX — a linear scale, both directions agree', () => {
  const start = new Date('2020-01-01T00:00:00Z');
  const end = new Date('2024-01-01T00:00:00Z');

  it('maps the domain start to x=0 and the domain end to x=width', () => {
    expect(xFromDate(start, start, end, 1000)).toBe(0);
    expect(xFromDate(end, start, end, 1000)).toBe(1000);
  });

  it('the midpoint date maps to the midpoint x, within rounding', () => {
    const mid = new Date('2022-01-01T00:00:00Z');
    expect(xFromDate(mid, start, end, 1000)).toBeCloseTo(500, 0);
  });

  it('dateFromX is the exact inverse of xFromDate', () => {
    const someDate = new Date('2021-06-15T00:00:00Z');
    const x = xFromDate(someDate, start, end, 800);
    const back = dateFromX(x, start, end, 800);
    expect(back.getTime()).toBeCloseTo(someDate.getTime(), -3);
  });

  it('a zero-width domain never divides by zero', () => {
    expect(xFromDate(start, start, start, 500)).toBe(0);
  });
});

describe('snapToMonth — clicking anywhere in a month lands on its 1st', () => {
  it('snaps mid-month to the 1st, in UTC', () => {
    const snapped = snapToMonth(new Date(Date.UTC(2026, 5, 17)));
    expect(snapped.toISOString()).toBe('2026-06-01T00:00:00.000Z');
  });
});

describe('densityLevel / densityLevelForLane — shrink by available room, not by raw count', () => {
  it.each([
    [200, 'label'], [160, 'label'], [100, 'short'], [90, 'short'], [50, 'symbol'], [40, 'symbol'], [20, 'cluster'], [0, 'cluster'],
  ])('avgSpacingPx=%d -> %s', (spacing, expected) => {
    expect(densityLevel(spacing)).toBe(expected);
  });

  it('a single event on a lane always reads as a full label', () => {
    expect(densityLevelForLane(50, 1)).toBe('label');
  });

  it('the SAME event count reads differently in a narrow vs a wide container', () => {
    expect(densityLevelForLane(2000, 10)).toBe('label'); // 200px/event
    expect(densityLevelForLane(200, 10)).toBe('cluster'); // 20px/event
  });
});

describe('clusterByProximity — events closer than the gap collapse into one chip', () => {
  it('two events far apart stay separate', () => {
    const clusters = clusterByProximity([{ item: 'a', x: 0 }, { item: 'b', x: 200 }]);
    expect(clusters).toHaveLength(2);
  });

  it('two events within the gap merge into one cluster', () => {
    const clusters = clusterByProximity([{ item: 'a', x: 0 }, { item: 'b', x: 10 }], 28);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].items).toEqual(['a', 'b']);
  });

  it('a chain of close events all merge into a single cluster (transitively)', () => {
    const clusters = clusterByProximity([{ item: 'a', x: 0 }, { item: 'b', x: 20 }, { item: 'c', x: 40 }], 28);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].items).toEqual(['a', 'b', 'c']);
  });

  it('cluster x is the running midpoint of its members, not the last-joined item', () => {
    const clusters = clusterByProximity([{ item: 'a', x: 0 }, { item: 'b', x: 10 }], 28);
    expect(clusters[0].x).toBe(5);
  });

  it('never mutates the input array', () => {
    const input = [{ item: 'b', x: 10 }, { item: 'a', x: 0 }];
    const copy = [...input];
    clusterByProximity(input);
    expect(input).toEqual(copy);
  });
});

describe('zoomWindow — narrows the domain, never widens past it', () => {
  const domainStart = new Date('2020-01-01T00:00:00Z');
  const domainEnd = new Date('2026-01-01T00:00:00Z');

  it('"all" always returns the full domain regardless of focus', () => {
    const w = zoomWindow('all', new Date('2023-05-01'), domainStart, domainEnd);
    expect(w.start).toEqual(domainStart);
    expect(w.end).toEqual(domainEnd);
  });

  it('"year" returns roughly a 12-month window centered on focus', () => {
    const focus = new Date(Date.UTC(2023, 5, 1));
    const w = zoomWindow('year', focus, domainStart, domainEnd);
    const months = (w.end.getUTCFullYear() - w.start.getUTCFullYear()) * 12 + (w.end.getUTCMonth() - w.start.getUTCMonth());
    expect(months).toBe(12);
  });

  it('clamps to the domain edge instead of showing empty space beyond it', () => {
    const focus = new Date(Date.UTC(2020, 0, 1)); // right at domainStart
    const w = zoomWindow('year', focus, domainStart, domainEnd);
    expect(w.start.getTime()).toBeGreaterThanOrEqual(domainStart.getTime());
  });
});

describe('matchesTimeToggle — Past/Future/Both (§C.3)', () => {
  it('both always matches', () => {
    expect(matchesTimeToggle('done', 'both')).toBe(true);
    expect(matchesTimeToggle('planned', 'both')).toBe(true);
  });
  it('past only matches done', () => {
    expect(matchesTimeToggle('done', 'past')).toBe(true);
    expect(matchesTimeToggle('planned', 'past')).toBe(false);
  });
  it('future only matches planned', () => {
    expect(matchesTimeToggle('planned', 'future')).toBe(true);
    expect(matchesTimeToggle('done', 'future')).toBe(false);
  });
});

describe('matchesCategoryVisibility (Prompt 382 §D) — the persistent per-category on/off cut', () => {
  const categories = [
    { id: 'c1', visible: true },
    { id: 'c2', visible: false },
  ];

  it('an event in a visible category matches', () => {
    expect(matchesCategoryVisibility('c1', categories)).toBe(true);
  });

  it('an event in an OFF category is excluded', () => {
    expect(matchesCategoryVisibility('c2', categories)).toBe(false);
  });

  it('General (category_id null) is never excluded — it is not a saved category at all', () => {
    expect(matchesCategoryVisibility(null, categories)).toBe(true);
    expect(matchesCategoryVisibility(undefined, categories)).toBe(true);
  });

  it('an unresolvable category id (e.g. a deleted category) reads as General — never excluded', () => {
    expect(matchesCategoryVisibility('does-not-exist', categories)).toBe(true);
  });

  it('with no category off at all, behaviour is identical to today — nothing regresses', () => {
    const allOn = [{ id: 'c1', visible: true }, { id: 'c2', visible: true }];
    expect(matchesCategoryVisibility('c1', allOn)).toBe(true);
    expect(matchesCategoryVisibility('c2', allOn)).toBe(true);
    expect(matchesCategoryVisibility(null, allOn)).toBe(true);
  });

  it('a category with visible omitted (undefined) defaults to shown', () => {
    expect(matchesCategoryVisibility('c3', [{ id: 'c3' }])).toBe(true);
  });
});

describe('migrateMilestoneToEvents — the pure half of migration 0237, nothing lost', () => {
  it('a year milestone becomes events dated Jan 1st of that year, precision approx', () => {
    const events = migrateMilestoneToEvents({
      period_kind: 'year', period_year: 2022, items_v2: [{ text: 'WomenTechEU prize', category_id: null }], items: [],
    });
    expect(events).toEqual([{ title: 'WomenTechEU prize', date: '2022-01-01', date_precision: 'approx', category_id: null }]);
  });

  it('a Q3 milestone becomes an event dated the 1st day of Q3, precision quarter', () => {
    const events = migrateMilestoneToEvents({
      period_kind: 'quarter', period_year: 2026, period_quarter: 3, items_v2: [{ text: 'Series A close', category_id: 'cat-1' }], items: [],
    });
    expect(events).toEqual([{ title: 'Series A close', date: '2026-07-01', date_precision: 'quarter', category_id: 'cat-1' }]);
  });

  it('legacy items (no items_v2) migrate as General (category_id null), text preserved', () => {
    const events = migrateMilestoneToEvents({ period_kind: 'year', period_year: 2020, items: ['Pre-seed investment, Portugal Ventures'] });
    expect(events).toEqual([{ title: 'Pre-seed investment, Portugal Ventures', date: '2020-01-01', date_precision: 'approx', category_id: null }]);
  });

  it('a milestone with MULTIPLE items produces one event per item — nothing collapses', () => {
    const events = migrateMilestoneToEvents({
      period_kind: 'year', period_year: 2026,
      items_v2: [{ text: 'CE marking', category_id: null }, { text: 'Hire CTO', category_id: null }], items: [],
    });
    expect(events).toHaveLength(2);
  });

  it('blank items are dropped, never migrated as "(untitled)" ghosts', () => {
    const events = migrateMilestoneToEvents({ period_kind: 'year', period_year: 2026, items: ['  ', 'Real item'] });
    expect(events.map((e) => e.title)).toEqual(['Real item']);
  });
});
