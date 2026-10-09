// Prompt 904 Adenda 1 (v2) — the pure behaviour behind the four sub-tabs: which sub-tab a URL means, the
// creation form vs the shortcut, search and sort on the two lists, the History filters, and the code list filter.
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEAT_TAB, SEAT_TABS, canDeleteSeatCode, createTabView, describeEvent, filterHistory, filterSeatCodes, parseSeatTab,
  searchPlans, seatCodeState, sortEnded, sortPlans, type EndedRow, type HistoryRow, type PlanRow,
} from './seat-plans-view';

const plan = (o: Partial<PlanRow> & { name: string }): PlanRow => ({
  entityId: `e-${o.name}`, planName: 'Private Detective', seats: 10, used: 0, reserved: 0, free: 10, adminEmail: null,
  activatedVia: 'backoffice', tier: 'tier_c', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...o,
});

describe('sub-tabs and the URL', () => {
  it('four sub-tabs, "Create plan" first and the default', () => {
    expect(SEAT_TABS).toEqual(['create', 'plans', 'history', 'ended']);
    expect(DEFAULT_SEAT_TAB).toBe('create');
  });

  it('?tab= decides the sub-tab; anything unknown or missing is the first one (a refresh keeps its place, a stale link is not blank)', () => {
    expect(parseSeatTab('plans')).toBe('plans');
    expect(parseSeatTab('history')).toBe('history');
    expect(parseSeatTab('ended')).toBe('ended');
    expect(parseSeatTab(null)).toBe('create');
    expect(parseSeatTab('')).toBe('create');
    expect(parseSeatTab('nonsense')).toBe('create');
    expect(parseSeatTab('PLANS')).toBe('create');
  });

  it('a firm that already has a plan is offered the shortcut, not the creation form', () => {
    expect(createTabView(true)).toBe('shortcut');
    expect(createTabView(false)).toBe('form');
  });
});

describe('sub-tab 2: firms with a plan', () => {
  const rows = [
    plan({ name: 'Zeta Capital', createdAt: '2026-03-01T00:00:00Z', updatedAt: '2026-03-02T00:00:00Z' }),
    plan({ name: 'alpha ventures', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' }),
    plan({ name: 'Mid Fund', createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z' }),
  ];

  it('by default the plan created most recently comes first', () => {
    expect(sortPlans(rows).map((r) => r.name)).toEqual(['Zeta Capital', 'Mid Fund', 'alpha ventures']);
  });
  it('sorts by last change, newest first, and by name, ignoring case', () => {
    expect(sortPlans(rows, 'changed').map((r) => r.name)).toEqual(['alpha ventures', 'Zeta Capital', 'Mid Fund']);
    expect(sortPlans(rows, 'name').map((r) => r.name)).toEqual(['alpha ventures', 'Mid Fund', 'Zeta Capital']);
  });
  it('sorting does not mutate the list it was given', () => {
    const copy = [...rows];
    sortPlans(rows, 'name');
    expect(rows).toEqual(copy);
  });
  it('searches by firm name: partial, any case, trimmed; empty search shows everything', () => {
    expect(searchPlans(rows, 'ALPHA').map((r) => r.name)).toEqual(['alpha ventures']);
    expect(searchPlans(rows, '  fund ').map((r) => r.name)).toEqual(['Mid Fund']);
    expect(searchPlans(rows, 'nothing')).toEqual([]);
    expect(searchPlans(rows, '')).toHaveLength(3);
  });
});

describe('sub-tab 4: ended plans', () => {
  const ended = (o: Partial<EndedRow> & { name: string; endedAt: string }): EndedRow => ({
    id: `a-${o.name}-${o.endedAt}`, entityId: `e-${o.name}`, planName: 'Private Detective', seats: 10, adminEmail: null, activatedVia: 'backoffice',
    planCreatedAt: '2026-01-01T00:00:00Z', endedByEmail: 'bo@x.com', members: [], reconstructed: false, ...o,
  });
  const rows = [
    ended({ name: 'Beta', endedAt: '2026-06-01T00:00:00Z' }),
    ended({ name: 'Alpha', endedAt: '2026-08-01T00:00:00Z' }),
    ended({ name: 'Alpha', endedAt: '2026-04-01T00:00:00Z' }),
  ];

  it('by default the plan that ended most recently comes first; the same firm may appear twice', () => {
    expect(sortEnded(rows).map((r) => `${r.name}@${r.endedAt.slice(0, 7)}`)).toEqual(['Alpha@2026-08', 'Beta@2026-06', 'Alpha@2026-04']);
  });
  it('by name, a firm\'s own plans stay newest first', () => {
    expect(sortEnded(rows, 'name').map((r) => `${r.name}@${r.endedAt.slice(0, 7)}`)).toEqual(['Alpha@2026-08', 'Alpha@2026-04', 'Beta@2026-06']);
  });
  it('searches by firm name', () => {
    expect(searchPlans(rows, 'alp')).toHaveLength(2);
  });
});

describe('sub-tab 3: the History filters', () => {
  const h = (id: number, o: Partial<HistoryRow>): HistoryRow => ({
    id, createdAt: '2026-10-01T10:00:00Z', entityId: 'e1', firm: 'Alpha Ventures', event: 'plan_set', actorEmail: 'bo@sherlock.com', personEmail: null, detail: {}, ...o,
  });
  const rows = [
    h(1, { createdAt: '2026-10-01T10:00:00Z' }),
    h(2, { createdAt: '2026-10-03T23:59:30Z', event: 'invite_created', detail: { email: 'Guest@External.com' } }),
    h(3, { createdAt: '2026-10-05T00:00:00Z', entityId: 'e2', firm: 'Beta Capital', event: 'seat_granted', personEmail: 'ana@beta.com' }),
    h(4, { createdAt: '2026-10-04T12:00:00Z', entityId: 'e2', firm: 'Beta Capital', event: 'code_deleted' }),
  ];

  it('newest first, whatever the order it arrived in', () => {
    expect(filterHistory(rows, {}).map((r) => r.id)).toEqual([3, 4, 2, 1]);
  });
  it('by firm and by event type', () => {
    expect(filterHistory(rows, { entityId: 'e2' }).map((r) => r.id)).toEqual([3, 4]);
    expect(filterHistory(rows, { event: 'invite_created' }).map((r) => r.id)).toEqual([2]);
    expect(filterHistory(rows, { entityId: 'e1', event: 'seat_granted' })).toEqual([]);
  });
  it('by date range, both ends inclusive of the whole day (UTC)', () => {
    expect(filterHistory(rows, { from: '2026-10-03', to: '2026-10-04' }).map((r) => r.id)).toEqual([4, 2]);
    expect(filterHistory(rows, { to: '2026-10-01' }).map((r) => r.id)).toEqual([1]);
    expect(filterHistory(rows, { from: '2026-10-05' }).map((r) => r.id)).toEqual([3]);
  });
  it('search matches the firm name, the actor, the person and the email in the detail, in any case', () => {
    expect(filterHistory(rows, { q: 'beta' }).map((r) => r.id)).toEqual([3, 4]);
    expect(filterHistory(rows, { q: 'ANA@BETA' }).map((r) => r.id)).toEqual([3]);
    expect(filterHistory(rows, { q: 'guest@external' }).map((r) => r.id)).toEqual([2]);
    expect(filterHistory(rows, { q: 'bo@sherlock' })).toHaveLength(4);
    expect(filterHistory(rows, { q: 'zzz' })).toEqual([]);
  });
  it('the filters combine', () => {
    expect(filterHistory(rows, { q: 'beta', event: 'code_deleted', from: '2026-10-04' }).map((r) => r.id)).toEqual([4]);
  });
  it('describes an event in a line', () => {
    expect(describeEvent({ event: 'plan_set', personEmail: null, detail: { seats: 10, previousSeats: 5, planName: 'Private Detective', adminEmail: 'a@b.com' } }))
      .toBe('5 → 10 seats · Private Detective · administrator a@b.com');
    expect(describeEvent({ event: 'claim_approved', personEmail: null, detail: { email: 'x@y.com', via: 'backoffice_add' } })).toBe('x@y.com · added directly by the back-office');
    expect(describeEvent({ event: 'code_deleted', personEmail: null, detail: { codeHint: 'AB12', wasState: 'revoked' } })).toBe('code …AB12 · was revoked');
    expect(describeEvent({ event: 'plan_ended', personEmail: null, detail: { seats: 10, members: 1 } })).toBe('10 seats · 1 member at the time');
  });
});

describe('the list of codes', () => {
  const now = new Date('2026-10-09T12:00:00Z');
  const future = '2026-11-01T00:00:00Z';
  const past = '2026-09-01T00:00:00Z';
  const codes = [
    { id: 'a', status: 'active' as const, expiresAt: future },
    { id: 'u', status: 'redeemed' as const, expiresAt: future },
    { id: 'r', status: 'revoked' as const, expiresAt: future },
    { id: 'e', status: 'active' as const, expiresAt: past },
  ];

  it('knows what each code is', () => {
    expect(codes.map((c) => seatCodeState(c, now))).toEqual(['active', 'used', 'revoked', 'expired']);
  });
  it('shows only the codes that can still be used, until "Show used, revoked and expired" is ticked', () => {
    expect(filterSeatCodes(codes, false, now).map((c) => c.id)).toEqual(['a']);
    expect(filterSeatCodes(codes, true, now).map((c) => c.id)).toEqual(['a', 'u', 'r', 'e']);
  });
  it('only a code that was never used may be deleted', () => {
    expect(codes.map((c) => canDeleteSeatCode(c))).toEqual([true, false, true, true]);
  });
});
