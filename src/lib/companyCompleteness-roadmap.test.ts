// Nuno, 20/10/2026, looking at Mob2is: "a company must not have a 100% profile, or close to it, if it has no roadmap data — if it has existed for at least a year it
// must have roadmap data, at least the history". Mob2is (founded 2023, empty roadmap) read 97%. These pin the rule: the roadmap's HISTORY is part of the score for
// a company that has existed for a year, the future is not, and a caller that cannot see the roadmap does not change a number it never looked at.
import { describe, expect, it } from 'vitest';
import { calcCompanyCompleteness, COMPLETENESS_FIELDS, companyAgeYears, ROADMAP_HISTORY_MIN_AGE_YEARS } from './companyCompleteness';
import type { CompanyPerson, Org } from './types';

const NOW = new Date('2026-10-20T12:00:00Z');
const FOUNDER = { id: 'p1', org_id: 'o1', name: 'zz-test Founder', is_founder: true } as unknown as CompanyPerson;

// every field of the score filled in, the company founded in 2023
function completeOrg(over: Record<string, unknown> = {}): Org {
  return {
    id: 'o1', name: 'zz-test Mob2is', legal_name: 'zz-test Mob2is, Lda', website: 'https://example.test', country: 'PT', hq_city: 'Lisbon', founded_year: 2023,
    sectors: ['mobility'], one_liner: 'one liner', description: 'a description', intro_problem: 'problem', intro_solution: 'solution', logo_url: 'https://example.test/l.png',
    postal_code: '1000-001', current_phase: 'mvp', revenue_eur: 0, employee_count: 4, primary_contact_person_id: 'p1',
    round_raising: true, stage: 'seed', round_target_eur: 500000, round_instruments: ['safe'], round_use_of_funds: 'product', round_target_close_date: '2027-03-01', round_runway_months: 12,
    ...over,
  } as unknown as Org;
}
const done = { status: 'done' };
const planned = { status: 'planned' };

describe('companyAgeYears — by the founding year', () => {
  it('counts calendar years, never negative, and says "unknown" when there is no year', () => {
    expect(companyAgeYears({ founded_year: 2023 }, NOW)).toBe(3);
    expect(companyAgeYears({ founded_year: 2025 }, NOW)).toBe(1);
    expect(companyAgeYears({ founded_year: 2026 }, NOW)).toBe(0);
    expect(companyAgeYears({ founded_year: 2030 }, NOW)).toBe(0);
    expect(companyAgeYears({ founded_year: undefined }, NOW)).toBeNull();
    expect(companyAgeYears({ founded_year: 0 }, NOW)).toBeNull();
  });
  it('a company is asked for its history from one year on', () => {
    expect(ROADMAP_HISTORY_MIN_AGE_YEARS).toBe(1);
  });
});

describe('the score without the roadmap in view (every caller that cannot see it) is what it always was', () => {
  it('a complete profile is 100% and has nothing missing', () => {
    const r = calcCompanyCompleteness(completeOrg(), [FOUNDER]);
    expect(r.pct).toBe(100);
    expect(r.missing).toEqual([]);
  });
  it('even with the clock given, the roadmap takes no part unless the events are passed', () => {
    expect(calcCompanyCompleteness(completeOrg(), [FOUNDER], { now: NOW }).pct).toBe(100);
  });
});

describe('roadmap.history — asked of a company that has existed for a year', () => {
  it('everything else complete, founded 2023, empty roadmap: 86%, and the history is what is missing', () => {
    const r = calcCompanyCompleteness(completeOrg(), [FOUNDER], { roadmapEvents: [], now: NOW });
    expect(r.pct).toBe(86);
    expect(r.missing.map((f) => f.id)).toEqual(['roadmap.history']);
    expect(r.missing[0].card).toBe('roadmap');
  });

  it('Mob2is\'s case: 97% without the roadmap in view becomes 83% once the empty roadmap is in view', () => {
    const org = completeOrg({ hq_city: '' }); // 4 points of 119 missing → 97%
    expect(calcCompanyCompleteness(org, [FOUNDER]).pct).toBe(97);
    expect(calcCompanyCompleteness(org, [FOUNDER], { roadmapEvents: [], now: NOW }).pct).toBe(83);
  });

  it('one milestone marked done and it is whole again', () => {
    const r = calcCompanyCompleteness(completeOrg(), [FOUNDER], { roadmapEvents: [done], now: NOW });
    expect(r.pct).toBe(100);
    expect(r.missing).toEqual([]);
  });

  it('plans alone are not history: the field stays missing', () => {
    const r = calcCompanyCompleteness(completeOrg(), [FOUNDER], { roadmapEvents: [planned, planned], now: NOW });
    expect(r.missing.map((f) => f.id)).toEqual(['roadmap.history']);
  });

  it('the future is not scored: history with no plan at all is 100%', () => {
    expect(calcCompanyCompleteness(completeOrg(), [FOUNDER], { roadmapEvents: [done], now: NOW }).pct).toBe(100);
  });

  it('a company founded this year is not asked for history yet; neither is one with no founding year', () => {
    expect(calcCompanyCompleteness(completeOrg({ founded_year: 2026 }), [FOUNDER], { roadmapEvents: [], now: NOW }).pct).toBe(100);
    const noYear = calcCompanyCompleteness(completeOrg({ founded_year: undefined }), [FOUNDER], { roadmapEvents: [], now: NOW });
    expect(noYear.missing.map((f) => f.id)).toEqual(['identity.founded_year']);
    expect(noYear.missing.some((f) => f.id === 'roadmap.history')).toBe(false);
  });

  it('a founded-last-year company is asked (the year is all we have)', () => {
    expect(calcCompanyCompleteness(completeOrg({ founded_year: 2025 }), [FOUNDER], { roadmapEvents: [], now: NOW }).missing.map((f) => f.id)).toEqual(['roadmap.history']);
  });

  it('not raising: the round fields drop out as before, the roadmap history still applies', () => {
    const org = completeOrg({ round_raising: false });
    expect(calcCompanyCompleteness(org, [FOUNDER], { roadmapEvents: [done], now: NOW }).pct).toBe(100);
    const r = calcCompanyCompleteness(org, [FOUNDER], { roadmapEvents: [], now: NOW });
    expect(r.missing.map((f) => f.id)).toEqual(['roadmap.history']);
    expect(r.pct).toBe(Math.round((101 / 121) * 100));
  });
});

describe('the field is declared the way the rest of the system reads it', () => {
  const field = COMPLETENESS_FIELDS.find((f) => f.id === 'roadmap.history')!;

  it('carries the weight of a section, in the one list the whole score reads', () => {
    expect(field.weight).toBe(20);
    expect(field.card).toBe('roadmap');
    expect(COMPLETENESS_FIELDS.filter((f) => f.id === 'roadmap.history')).toHaveLength(1);
  });

  it('is the only field that is conditional on something other than the round', () => {
    expect(COMPLETENESS_FIELDS.filter((f) => f.applies).map((f) => f.id)).toEqual(['roadmap.history']);
  });
});
