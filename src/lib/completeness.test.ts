import { describe, expect, it } from 'vitest';
import { entityCompleteness, personCompleteness, qualifiesForContactEnrichment, ENRICHMENT_THRESHOLD, gradeFromPercent, manualEntityCompleteness, type ManualEntityCompletenessFields } from './completeness';
import type { Entity, Person } from './types';

function ent(p: Partial<Entity> = {}): Entity {
  return {
    id: 'e1', name: 'MAZE (Mustard Seed MAZE)', type: 'vc', invests_in_geographies: [], sectors: [],
    website_verified: false, email_domain_verified: false, submission_channel_type: 'unknown',
    hard_filter_status: 'none', status: 'not_contacted',
    ...p,
  } as Entity;
}

function per(p: Partial<Person> = {}): Person {
  return {
    id: 'p1', entity_id: 'e1', full_name: 'Jane Doe', seniority_rank: 1,
    linkedin_verified: false, bounce_count: 0, linked_companies: [], linked_funds: [],
    hook_status: 'none', kill_words: [], preferred_language: 'en', privacy_notice_sent: false,
    do_not_contact: false,
    ...p,
  } as Person;
}

describe('entityCompleteness', () => {
  it('splits into firmographic (6 checks) and contact (5 checks) dimensions', () => {
    const c = entityCompleteness(ent());
    expect(c.firmographic.missing).toHaveLength(6);
    expect(c.contact.missing).toHaveLength(5);
  });

  it('reproduces the MAZE case: full firmographic data, zero contact data', () => {
    const e = ent({
      website: 'https://maze-impact.com', email_domain: 'maze-impact.com', thesis: 'Impact investing',
      check_min_eur: 100000, check_max_eur: 1000000, stage_min: 'pre_seed', stage_max: 'seed',
      sectors: ['healthcare'],
      email: undefined, phone: undefined, address: undefined, postal_code: undefined, key_people: undefined,
    });
    const c = entityCompleteness(e);
    expect(c.firmographic.percent).toBe(100);
    expect(c.contact.percent).toBe(0);
    expect(c.contact.missing).toEqual(['email', 'phone', 'address', 'postal code', 'key people']);
  });

  it('scores contact fields independently of firmographic ones', () => {
    const e = ent({ email: 'ir@fund.vc', phone: '+351 000 000 000', address: undefined, postal_code: undefined, key_people: undefined });
    const c = entityCompleteness(e);
    expect(c.contact.percent).toBe(40); // 2 of 5
    expect(c.contact.missing).toEqual(['address', 'postal code', 'key people']);
  });
});

describe('qualifiesForContactEnrichment', () => {
  it('flags a firmographically-solid entity with zero contact data (the MAZE case)', () => {
    const e = ent({
      website: 'https://maze-impact.com', email_domain: 'maze-impact.com', thesis: 'Impact investing',
      check_min_eur: 100000, check_max_eur: 1000000, stage_min: 'pre_seed', stage_max: 'seed', sectors: ['healthcare'],
    });
    expect(qualifiesForContactEnrichment(entityCompleteness(e))).toBe(true);
  });

  it('does NOT flag an entity incomplete on both fronts — that belongs to the firmographic queue only', () => {
    const e = ent(); // nothing set at all
    expect(qualifiesForContactEnrichment(entityCompleteness(e))).toBe(false);
  });

  it('does NOT flag an entity with partial (non-zero) contact data', () => {
    const e = ent({
      website: 'https://x.vc', email_domain: 'x.vc', thesis: 't', check_min_eur: 1, check_max_eur: 2,
      stage_min: 'seed', stage_max: 'seed', sectors: ['fintech'], email: 'a@x.vc',
    });
    expect(qualifiesForContactEnrichment(entityCompleteness(e))).toBe(false);
  });

  it('does not flag a firmographic score right at the threshold boundary below 70', () => {
    // 4 of 6 firmographic checks = 67%, just under ENRICHMENT_THRESHOLD
    const e = ent({ website: 'https://x.vc', email_domain: 'x.vc', thesis: 't', check_min_eur: 1, check_max_eur: 2 });
    const c = entityCompleteness(e);
    expect(c.firmographic.percent).toBeLessThan(ENRICHMENT_THRESHOLD);
    expect(qualifiesForContactEnrichment(c)).toBe(false);
  });
});

describe('gradeFromPercent', () => {
  // Cutoffs measured against the real 757 "Added by startups" rows
  // (2026-08-19): kept as proposed, no bucket came out degenerate.
  it.each([
    [100, 'A'], [80, 'A'], [79, 'B'], [60, 'B'], [59, 'C'], [40, 'C'], [39, 'D'], [20, 'D'], [19, 'E'], [0, 'E'],
  ] as const)('%i%% -> grade %s', (percent, grade) => {
    expect(gradeFromPercent(percent)).toBe(grade);
  });
});

describe('manualEntityCompleteness', () => {
  function fields(p: Partial<ManualEntityCompletenessFields> = {}): ManualEntityCompletenessFields {
    return {
      website: null, hqCity: null, hqCountry: null, geographies: null, stageMin: null, stageMax: null,
      checkMinEur: null, checkMaxEur: null, sectors: [], contactCount: 0,
      ...p,
    };
  }

  it('scores 0% and grade E when nothing at all is filled in', () => {
    const c = manualEntityCompleteness(fields());
    expect(c.percent).toBe(0);
    expect(c.grade).toBe('E');
    expect(c.missing).toHaveLength(10);
  });

  it('scores 100% and grade A when every one of the 10 fields is present', () => {
    const c = manualEntityCompleteness(fields({
      website: 'https://x.vc', hqCity: 'Lisbon', hqCountry: 'PT', geographies: ['Europe'],
      stageMin: 'seed', stageMax: 'seed', checkMinEur: 1, checkMaxEur: 2, sectors: ['fintech'], contactCount: 1,
    }));
    expect(c.percent).toBe(100);
    expect(c.grade).toBe('A');
    expect(c.missing).toHaveLength(0);
  });

  // Real distribution's dominant cluster (36.9% of all 757 rows land here
  // exactly): 7 of 10 fields present.
  it('reproduces the real 70%-cluster shape (7 of 10 fields) as grade B', () => {
    const c = manualEntityCompleteness(fields({
      website: 'https://x.vc', hqCity: 'Berlin', hqCountry: 'DE', geographies: ['Europe'],
      stageMin: 'seed', stageMax: 'series_a', sectors: ['deeptech'],
      // checkMinEur/checkMaxEur/contactCount left absent — exactly 3 of 10 missing.
    }));
    expect(c.percent).toBe(70);
    expect(c.grade).toBe('B');
  });

  it('treats an empty geographies array the same as null (no credit)', () => {
    const withNull = manualEntityCompleteness(fields({ geographies: null }));
    const withEmpty = manualEntityCompleteness(fields({ geographies: [] }));
    expect(withEmpty.percent).toBe(withNull.percent);
  });

  it('only counts contacts by presence (>0), not by how many', () => {
    const one = manualEntityCompleteness(fields({ contactCount: 1 }));
    const five = manualEntityCompleteness(fields({ contactCount: 5 }));
    expect(one.percent).toBe(five.percent);
  });
});

describe('personCompleteness', () => {
  it('checks phone alongside the pre-existing fields', () => {
    const c = personCompleteness(per());
    expect(c.missing).toContain('phone');
  });

  it('counts phone as present once set', () => {
    const withoutPhone = personCompleteness(per());
    const withPhone = personCompleteness(per({ phone: '+351 900 000 000' }));
    expect(withPhone.percent).toBeGreaterThan(withoutPhone.percent);
    expect(withPhone.missing).not.toContain('phone');
  });
});
