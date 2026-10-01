import { describe, expect, it } from 'vitest';
import { channelOutcomes, channelOutcomesSummary } from './channel-learning';
import type { Db, Entity, Interaction, Person } from './types';

function makeEntity(overrides: Partial<Entity> & { id: string }): Entity {
  return {
    name: overrides.id, type: 'vc', invests_in_geographies: [], website_verified: false,
    email_domain_verified: false, sectors: [], submission_channel_type: 'unknown',
    hard_filter_status: 'not_applicable', status: 'not_contacted', source: 'manual',
    ...overrides,
  };
}

function makeInteraction(overrides: Partial<Interaction> & { id: string; entity_id: string; occurred_at: string; direction: 'in' | 'out' }): Interaction {
  return { channel: 'email', content: '', ...overrides };
}

function makePerson(overrides: Partial<Person> & { id: string; entity_id: string; full_name: string; seniority_rank: number }): Person {
  return { linkedin_verified: false, bounce_count: 0, linked_companies: [], linked_funds: [], hook_status: 'to_research', kill_words: [], preferred_language: 'en', privacy_notice_sent: false, do_not_contact: false, ...overrides };
}

function makeDb(entities: Entity[], interactions: Interaction[] = [], people: Person[] = []): Db {
  return {
    catalog: [], packs: [], unlocks: [], submissions: [],
    org: { id: 'org-1', name: 'ablute_', plan: 'idea', daily_cap: 5, weekly_cap: 20 },
    entities, people, catalogPeopleLinkedIn: {}, personAffiliations: [], interactions,
    tasks: [], relationshipState: [], overrides: [], folders: [], documents: [],
    grants: [], views: [], templates: [], automations: [], runs: [], aiReviews: [], companyFacts: [], ndas: [], documentVersions: [], reawakeningProposals: [],
    companyPeople: [], tractionMetrics: [], roadmapMilestones: [], fundingRounds: [], roadmapCategories: [], roadmapEvents: [], rejectionCodes: [], interactionEdits: [], orgAxisClassifications: [],
    interactionDocuments: [], sherlockNextSnoozes: [], entityReopenSnapshots: [], capTableEntries: [],
    startupInvestorDecisions: [],
    dealTerms: [],
  };
}

describe('channelOutcomes — Prompt 893 §C, Fase 1 (measure only, never a tie-break)', () => {
  it('zero data → an empty list, and the summary formatter says so honestly', () => {
    const db = makeDb([makeEntity({ id: 'ent-1' })]);
    expect(channelOutcomes(db)).toEqual([]);
    expect(channelOutcomesSummary(channelOutcomes(db))).toBe('No outcome data yet.');
  });

  it('one channel: counts first contacts and replies within 14 days, computes the rate', () => {
    const entity = makeEntity({ id: 'ent-1' });
    const p1 = makePerson({ id: 'p-1', entity_id: 'ent-1', full_name: 'A', seniority_rank: 1 });
    const p2 = makePerson({ id: 'p-2', entity_id: 'ent-1', full_name: 'B', seniority_rank: 1 });
    const p3 = makePerson({ id: 'p-3', entity_id: 'ent-1', full_name: 'C', seniority_rank: 1 });
    const db = makeDb([entity], [
      makeInteraction({ id: 'o1', entity_id: 'ent-1', person_id: 'p-1', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'linkedin_note' }),
      makeInteraction({ id: 'i1', entity_id: 'ent-1', person_id: 'p-1', occurred_at: '2026-07-05T00:00:00.000Z', direction: 'in', channel: 'linkedin_note' }),
      makeInteraction({ id: 'o2', entity_id: 'ent-1', person_id: 'p-2', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'linkedin_note' }),
      makeInteraction({ id: 'i2', entity_id: 'ent-1', person_id: 'p-2', occurred_at: '2026-07-10T00:00:00.000Z', direction: 'in', channel: 'linkedin_note' }),
      makeInteraction({ id: 'o3', entity_id: 'ent-1', person_id: 'p-3', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'linkedin_note' }),
      // no reply at all for p-3
    ], [p1, p2, p3]);
    const outcomes = channelOutcomes(db);
    expect(outcomes).toEqual([{ channel: 'linkedin_note', outboundFirstContacts: 3, repliedWithin14d: 2, rate: 2 / 3 }]);
    expect(channelOutcomesSummary(outcomes)).toBe('Your replies by channel: LinkedIn note 2/3');
  });

  it('two channels: each tracked independently, most-used first', () => {
    const entity = makeEntity({ id: 'ent-1' });
    const p1 = makePerson({ id: 'p-1', entity_id: 'ent-1', full_name: 'A', seniority_rank: 1 });
    const p2 = makePerson({ id: 'p-2', entity_id: 'ent-1', full_name: 'B', seniority_rank: 1 });
    const p3 = makePerson({ id: 'p-3', entity_id: 'ent-1', full_name: 'C', seniority_rank: 1 });
    const p4 = makePerson({ id: 'p-4', entity_id: 'ent-1', full_name: 'D', seniority_rank: 1 });
    const db = makeDb([entity], [
      makeInteraction({ id: 'o1', entity_id: 'ent-1', person_id: 'p-1', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'linkedin_note' }),
      makeInteraction({ id: 'i1', entity_id: 'ent-1', person_id: 'p-1', occurred_at: '2026-07-03T00:00:00.000Z', direction: 'in', channel: 'linkedin_note' }),
      makeInteraction({ id: 'o2', entity_id: 'ent-1', person_id: 'p-2', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'linkedin_note' }),
      makeInteraction({ id: 'o3', entity_id: 'ent-1', person_id: 'p-3', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'linkedin_note' }),
      makeInteraction({ id: 'o4', entity_id: 'ent-1', person_id: 'p-4', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'email' }),
      makeInteraction({ id: 'i4', entity_id: 'ent-1', person_id: 'p-4', occurred_at: '2026-07-02T00:00:00.000Z', direction: 'in', channel: 'email' }),
    ], [p1, p2, p3, p4]);
    const outcomes = channelOutcomes(db);
    expect(outcomes).toEqual([
      { channel: 'linkedin_note', outboundFirstContacts: 3, repliedWithin14d: 1, rate: 1 / 3 },
      { channel: 'email', outboundFirstContacts: 1, repliedWithin14d: 1, rate: 1 },
    ]);
    expect(channelOutcomesSummary(outcomes)).toBe('Your replies by channel: LinkedIn note 1/3 · Email 1/1');
  });

  it('a reply exactly 14 days later counts; exactly 15 days later does not', () => {
    const entity = makeEntity({ id: 'ent-1' });
    const p1 = makePerson({ id: 'p-1', entity_id: 'ent-1', full_name: 'A', seniority_rank: 1 });
    const p2 = makePerson({ id: 'p-2', entity_id: 'ent-1', full_name: 'B', seniority_rank: 1 });
    const db = makeDb([entity], [
      makeInteraction({ id: 'o1', entity_id: 'ent-1', person_id: 'p-1', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'email' }),
      makeInteraction({ id: 'i1', entity_id: 'ent-1', person_id: 'p-1', occurred_at: '2026-07-15T00:00:00.000Z', direction: 'in', channel: 'email' }), // +14d
      makeInteraction({ id: 'o2', entity_id: 'ent-1', person_id: 'p-2', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'email' }),
      makeInteraction({ id: 'i2', entity_id: 'ent-1', person_id: 'p-2', occurred_at: '2026-07-16T00:00:00.000Z', direction: 'in', channel: 'email' }), // +15d
    ], [p1, p2]);
    const outcomes = channelOutcomes(db);
    expect(outcomes).toEqual([{ channel: 'email', outboundFirstContacts: 2, repliedWithin14d: 1, rate: 0.5 }]);
  });

  it('only the FIRST outbound per (entity, person) counts as a first contact — a follow-up on the same pair is not a second one', () => {
    const entity = makeEntity({ id: 'ent-1' });
    const p1 = makePerson({ id: 'p-1', entity_id: 'ent-1', full_name: 'A', seniority_rank: 1 });
    const db = makeDb([entity], [
      makeInteraction({ id: 'o1', entity_id: 'ent-1', person_id: 'p-1', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'linkedin_note' }),
      makeInteraction({ id: 'o2', entity_id: 'ent-1', person_id: 'p-1', occurred_at: '2026-07-20T00:00:00.000Z', direction: 'out', channel: 'email' }), // a follow-up, different channel
    ], [p1]);
    const outcomes = channelOutcomes(db);
    expect(outcomes).toEqual([{ channel: 'linkedin_note', outboundFirstContacts: 1, repliedWithin14d: 0, rate: 0 }]);
  });

  it('stage_change is never counted as an outreach channel', () => {
    const entity = makeEntity({ id: 'ent-1' });
    const p1 = makePerson({ id: 'p-1', entity_id: 'ent-1', full_name: 'A', seniority_rank: 1 });
    const db = makeDb([entity], [
      makeInteraction({ id: 'o1', entity_id: 'ent-1', person_id: 'p-1', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'stage_change' }),
    ], [p1]);
    expect(channelOutcomes(db)).toEqual([]);
  });

  it('filters by entityType when asked (Fase 2 plumbing, unused by any caller yet)', () => {
    const vc = makeEntity({ id: 'ent-vc', type: 'vc' });
    const angel = makeEntity({ id: 'ent-angel', type: 'angel_fund' });
    const p1 = makePerson({ id: 'p-1', entity_id: 'ent-vc', full_name: 'A', seniority_rank: 1 });
    const p2 = makePerson({ id: 'p-2', entity_id: 'ent-angel', full_name: 'B', seniority_rank: 1 });
    const db = makeDb([vc, angel], [
      makeInteraction({ id: 'o1', entity_id: 'ent-vc', person_id: 'p-1', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'email' }),
      makeInteraction({ id: 'o2', entity_id: 'ent-angel', person_id: 'p-2', occurred_at: '2026-07-01T00:00:00.000Z', direction: 'out', channel: 'linkedin_note' }),
    ], [p1, p2]);
    expect(channelOutcomes(db, { entityType: 'vc' })).toEqual([{ channel: 'email', outboundFirstContacts: 1, repliedWithin14d: 0, rate: 0 }]);
  });
});
