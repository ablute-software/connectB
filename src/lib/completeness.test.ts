import { describe, expect, it } from 'vitest';
import { entityCompleteness, personCompleteness, qualifiesForContactEnrichment, ENRICHMENT_THRESHOLD } from './completeness';
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
