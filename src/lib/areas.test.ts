// Prompt 923 (A) — every combination of what a person can be (only a founder, only a firm member, only data rooms, founder + firm, founder + firm + data room, nothing) goes to the right area and is offered the
// right selector. The 28/10/2026 case — a founder who is also a firm member choosing "Investor" — lands in the firm's workspace, never on a data-room dead end.
import { describe, expect, it } from 'vitest';
import { AREA_LABEL, AREA_PATH, areasOf, landingArea, lastAreaCookie, parseArea, parseIntent, selectorOptions, type Area } from './areas';
import type { RoleSignals } from './role-decision';

const none: RoleSignals = { isPlatformAdmin: false, hasOpenFounderOrg: false, hasActiveIncubatorMembership: false, hasApprovedClaim: false, hasActiveInvestorMembership: false, hasAccessGrant: false, isAbluteTeamEmailConfirmed: false, hasPendingClaim: false };
const sig = (o: Partial<RoleSignals>): RoleSignals => ({ ...none, ...o });
const FOUNDER = sig({ hasOpenFounderOrg: true });
const FIRM = sig({ hasActiveInvestorMembership: true });
const ROOMS = sig({ hasAccessGrant: true });
const FOUNDER_FIRM = sig({ hasOpenFounderOrg: true, hasActiveInvestorMembership: true });
const ALL = sig({ hasOpenFounderOrg: true, hasActiveInvestorMembership: true, hasAccessGrant: true });

describe('the areas a person can open', () => {
  it.each<[string, RoleSignals, Area[]]>([
    ['only a founder', FOUNDER, ['founder']],
    ['only a firm member', FIRM, ['investor']],
    ['only data rooms', ROOMS, ['dataroom']],
    ['a founder who is also a firm member', FOUNDER_FIRM, ['founder', 'investor']],
    ['a founder, a firm member and data rooms', ALL, ['founder', 'investor', 'dataroom']],
    ['nothing', none, []],
    ['an approved claim counts as the firm', sig({ hasApprovedClaim: true }), ['investor']],
    ['an ecosystem member', sig({ hasActiveIncubatorMembership: true }), ['ecosystem']],
    ['a platform administrator lands in the founder workspace', sig({ isPlatformAdmin: true }), ['founder']],
    ['a confirmed @ablute.pt account without anything else', sig({ isAbluteTeamEmailConfirmed: true }), ['founder']],
    ['a pending claim is not an area (it has its own page)', sig({ hasPendingClaim: true }), []],
  ])('%s', (_name, signals, expected) => { expect(areasOf(signals)).toEqual(expected); });
});

describe('where each combination lands', () => {
  it('only a founder → founder; only a firm → the firm; only data rooms → the data rooms; nothing → no area', () => {
    expect(landingArea(areasOf(FOUNDER))).toBe('founder');
    expect(landingArea(areasOf(FIRM))).toBe('investor');
    expect(landingArea(areasOf(ROOMS))).toBe('dataroom');
    expect(landingArea(areasOf(none))).toBeNull();
  });
  it('a founder who is also a firm member lands in the founder workspace by default — and in the FIRM when they chose "Investor" (the 28/10 case)', () => {
    expect(landingArea(areasOf(FOUNDER_FIRM))).toBe('founder');
    expect(landingArea(areasOf(FOUNDER_FIRM), { intent: 'investor' })).toBe('investor');
    expect(AREA_PATH.investor).toBe('/portal');
  });
  it('"Investor" with no firm goes to the data rooms; "Startup" with no startup falls through to what the person has', () => {
    expect(landingArea(areasOf(ROOMS), { intent: 'investor' })).toBe('dataroom');
    expect(landingArea(areasOf(FIRM), { intent: 'founder' })).toBe('investor');
    expect(landingArea(areasOf(ALL), { intent: 'investor' })).toBe('investor');            // a firm member who also has data rooms: the firm first, the rooms are in the menu
  });
  it('several areas, no choice: the one used last (while still held), otherwise the first in order', () => {
    expect(landingArea(areasOf(ALL), { last: 'dataroom' })).toBe('dataroom');
    expect(landingArea(areasOf(ALL), { last: 'investor' })).toBe('investor');
    expect(landingArea(areasOf(FOUNDER), { last: 'investor' })).toBe('founder');           // the last area is gone: never a dead end
    expect(landingArea(areasOf(ALL), { intent: 'founder', last: 'investor' })).toBe('founder');   // a choice at the login beats the last one
    expect(landingArea(areasOf(ALL))).toBe('founder');
  });
  it('the cookie and the query values are read strictly', () => {
    expect(parseArea('investor')).toBe('investor');
    expect(parseArea('admin')).toBeNull(); expect(parseArea(undefined)).toBeNull(); expect(parseArea(['investor'])).toBeNull();
    expect(parseIntent('investor')).toBe('investor'); expect(parseIntent('dataroom')).toBeNull();
    expect(lastAreaCookie('investor')).toBe('sd_area=investor; path=/; max-age=31536000; SameSite=Lax');
  });
});

describe('the selector in the menu: only the areas the person has', () => {
  it('one area → one option (the screen shows nothing to switch); two or three → exactly those, in order, with where each leads', () => {
    expect(selectorOptions(areasOf(FOUNDER)).map((o) => o.area)).toEqual(['founder']);
    expect(selectorOptions(areasOf(FOUNDER_FIRM))).toEqual([
      { area: 'founder', label: 'Founder workspace', href: '/pipeline' }, { area: 'investor', label: 'Investor workspace', href: '/portal' },
    ]);
    expect(selectorOptions(areasOf(ALL)).map((o) => o.label)).toEqual([AREA_LABEL.founder, AREA_LABEL.investor, AREA_LABEL.dataroom]);
    expect(selectorOptions(areasOf(none))).toEqual([]);
  });
});
