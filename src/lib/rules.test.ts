import { describe, expect, it } from 'vitest';
import { preflight } from './rules';
import type { Db, Entity, Interaction, Person } from './types';

function makeEntity(overrides: Partial<Entity> & { id: string }): Entity {
  return {
    name: overrides.id, type: 'vc', invests_in_geographies: [], website_verified: false,
    email_domain_verified: false, sectors: [], submission_channel_type: 'unknown',
    hard_filter_status: 'not_applicable', status: 'not_contacted',
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> & { id: string; entity_id: string; seniority_rank: number }): Person {
  return {
    full_name: overrides.id, linkedin_verified: false, bounce_count: 0,
    linked_companies: [], linked_funds: [], hook_status: 'researched', kill_words: [],
    preferred_language: 'en', privacy_notice_sent: false, do_not_contact: false,
    ...overrides,
  };
}

function makeDb(entities: Entity[], people: Person[], interactions: Interaction[] = []): Db {
  return {
    catalog: [], packs: [], unlocks: [], submissions: [],
    org: { id: 'org-1', name: 'ablute_', plan: 'free', daily_cap: 5, weekly_cap: 20 },
    entities, people, personAffiliations: [], interactions,
    tasks: [], relationshipState: [], overrides: [], folders: [], documents: [],
    grants: [], views: [], templates: [], automations: [], runs: [], aiReviews: [], companyFacts: [],
  };
}

function seniorityCheck(db: Db, person: Person) {
  return preflight(db, person, null).find((c) => c.key === 'seniority')!;
}

describe('preflight — seniority order', () => {
  // Reported case: Adara Ventures, Alberto Gomez (rank 2) about to be
  // approached while Rocio Pillado (rank 1) is still not_contacted at all
  // — no interactions exist for either. This must block, not pass.
  it('blocks a junior contact when a more senior one has never been contacted', () => {
    const entity = makeEntity({ id: 'ent-adara', name: 'Adara Ventures' });
    const rocio = makePerson({ id: 'p-rocio', entity_id: 'ent-adara', seniority_rank: 1, full_name: 'Rocio Pillado' });
    const alberto = makePerson({ id: 'p-alberto', entity_id: 'ent-adara', seniority_rank: 2, full_name: 'Alberto Gomez' });
    const db = makeDb([entity], [rocio, alberto], []);

    const check = seniorityCheck(db, alberto);
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/Rocio Pillado/);
  });

  it('blocks a junior contact when a more senior one was contacted but has not replied', () => {
    const entity = makeEntity({ id: 'ent-adara', name: 'Adara Ventures' });
    const rocio = makePerson({ id: 'p-rocio', entity_id: 'ent-adara', seniority_rank: 1, full_name: 'Rocio Pillado' });
    const alberto = makePerson({ id: 'p-alberto', entity_id: 'ent-adara', seniority_rank: 2, full_name: 'Alberto Gomez' });
    const outbound: Interaction = {
      id: 'i-1', entity_id: 'ent-adara', person_id: 'p-rocio', occurred_at: '2026-07-01T00:00:00Z',
      direction: 'out', channel: 'linkedin_dm', content: 'hi',
    };
    const db = makeDb([entity], [rocio, alberto], [outbound]);

    const check = seniorityCheck(db, alberto);
    expect(check.ok).toBe(false);
  });

  it('allows a junior contact once the more senior one has replied', () => {
    const entity = makeEntity({ id: 'ent-adara', name: 'Adara Ventures' });
    const rocio = makePerson({ id: 'p-rocio', entity_id: 'ent-adara', seniority_rank: 1, full_name: 'Rocio Pillado' });
    const alberto = makePerson({ id: 'p-alberto', entity_id: 'ent-adara', seniority_rank: 2, full_name: 'Alberto Gomez' });
    const outbound: Interaction = {
      id: 'i-1', entity_id: 'ent-adara', person_id: 'p-rocio', occurred_at: '2026-07-01T00:00:00Z',
      direction: 'out', channel: 'linkedin_dm', content: 'hi',
    };
    const reply: Interaction = {
      id: 'i-2', entity_id: 'ent-adara', person_id: 'p-rocio', occurred_at: '2026-07-03T00:00:00Z',
      direction: 'in', channel: 'linkedin_dm', content: 'not for us, but try Alberto',
    };
    const db = makeDb([entity], [rocio, alberto], [outbound, reply]);

    const check = seniorityCheck(db, alberto);
    expect(check.ok).toBe(true);
  });

  it('ignores a more senior contact who is marked do_not_contact', () => {
    const entity = makeEntity({ id: 'ent-adara', name: 'Adara Ventures' });
    const rocio = makePerson({ id: 'p-rocio', entity_id: 'ent-adara', seniority_rank: 1, full_name: 'Rocio Pillado', do_not_contact: true });
    const alberto = makePerson({ id: 'p-alberto', entity_id: 'ent-adara', seniority_rank: 2, full_name: 'Alberto Gomez' });
    const db = makeDb([entity], [rocio, alberto], []);

    const check = seniorityCheck(db, alberto);
    expect(check.ok).toBe(true);
  });

  it('is not triggered for the most senior contact at the entity', () => {
    const entity = makeEntity({ id: 'ent-adara', name: 'Adara Ventures' });
    const rocio = makePerson({ id: 'p-rocio', entity_id: 'ent-adara', seniority_rank: 1, full_name: 'Rocio Pillado' });
    const db = makeDb([entity], [rocio], []);

    const check = seniorityCheck(db, rocio);
    expect(check.ok).toBe(true);
  });
});
