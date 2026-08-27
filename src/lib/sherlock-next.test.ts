import { describe, expect, it } from 'vitest';
import { sherlockNext } from './sherlock-next';
import type { Db, Entity, Interaction, Person, TaskItem } from './types';

function makeEntity(overrides: Partial<Entity> & { id: string }): Entity {
  return {
    name: overrides.id, type: 'vc', invests_in_geographies: [], website_verified: false,
    email_domain_verified: false, sectors: [], submission_channel_type: 'unknown',
    hard_filter_status: 'not_applicable', status: 'not_contacted', source: 'manual',
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

function makeDb(overrides: Partial<Db> = {}): Db {
  return {
    catalog: [], packs: [], unlocks: [], submissions: [],
    org: { id: 'org-1', name: 'ablute_', plan: 'idea', daily_cap: 5, weekly_cap: 20 },
    entities: [], people: [], personAffiliations: [], interactions: [],
    tasks: [], relationshipState: [], overrides: [], folders: [], documents: [],
    grants: [], views: [], templates: [], automations: [], runs: [], aiReviews: [], companyFacts: [], ndas: [], documentVersions: [], reawakeningProposals: [],
    companyPeople: [], tractionMetrics: [], roadmapMilestones: [], fundingRounds: [], roadmapCategories: [], roadmapEvents: [], rejectionCodes: [], interactionEdits: [], orgAxisClassifications: [],
    interactionDocuments: [],
    ...overrides,
  };
}

const NOW = new Date('2026-08-27T12:00:00Z');

describe('sherlockNext — priority ladder', () => {
  it('1: a pending investor interest request wins over everything else', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital' });
    const task: TaskItem = {
      id: 't-1', title: 'Nina Capital requested contact access', due_at: '2026-08-20T00:00:00Z',
      entity_id: 'ent-a', kind: 'follow_up', action_type: 'follow_up_thread', done: false,
      source: 'interest_level_request',
    };
    const db = makeDb({ entities: [entity], tasks: [task] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('interest_request');
    expect(step.target).toBe('/today');
    expect(step.label).toContain('Nina Capital');
  });

  it('1b: the OLDEST pending interest request wins when several exist', () => {
    const older: TaskItem = {
      id: 't-old', title: 'Older ask', due_at: '2026-08-01T00:00:00Z', entity_id: 'ent-a',
      kind: 'follow_up', action_type: 'follow_up_thread', done: false, source: 'interest_level_request',
    };
    const newer: TaskItem = {
      id: 't-new', title: 'Newer ask', due_at: '2026-08-20T00:00:00Z', entity_id: 'ent-b',
      kind: 'follow_up', action_type: 'follow_up_thread', done: false, source: 'interest_level_request',
    };
    const db = makeDb({ tasks: [newer, older] });

    const step = sherlockNext(db, NOW);
    expect(step.label).toContain('Older ask');
  });

  it('2: oldest unclassified reply, once no interest request is pending', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital' });
    const reply: Interaction = {
      id: 'i-1', entity_id: 'ent-a', occurred_at: '2026-08-20T00:00:00Z',
      direction: 'in', channel: 'email', content: 'hi', classification: undefined,
    };
    const db = makeDb({ entities: [entity], interactions: [reply] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('unclassified_reply');
    expect(step.entityId).toBe('ent-a');
    expect(step.target).toBe('/entities/ent-a?rail=history&classify=1');
  });

  it("2b: an inbound reply already classified 'awaiting' still counts as unclassified", () => {
    const entity = makeEntity({ id: 'ent-a' });
    const reply: Interaction = {
      id: 'i-1', entity_id: 'ent-a', occurred_at: '2026-08-20T00:00:00Z',
      direction: 'in', channel: 'email', content: 'hi', classification: 'awaiting',
    };
    const db = makeDb({ entities: [entity], interactions: [reply] });

    expect(sherlockNext(db, NOW).kind).toBe('unclassified_reply');
  });

  it("2c: a reply already classified something real (e.g. 'pass') does NOT count", () => {
    const entity = makeEntity({ id: 'ent-a' });
    const reply: Interaction = {
      id: 'i-1', entity_id: 'ent-a', occurred_at: '2026-08-20T00:00:00Z',
      direction: 'in', channel: 'email', content: 'no thanks', classification: 'pass',
      pass_reason: 'not a fit',
    };
    const db = makeDb({ entities: [entity], interactions: [reply] });

    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });

  it('3: the most overdue follow-up, once nothing pending/unclassified remains', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital', status: 'contacted' });
    const person = makePerson({ id: 'p-1', entity_id: 'ent-a', seniority_rank: 1, full_name: 'Marta Zanchi' });
    const outbound: Interaction = {
      id: 'i-1', entity_id: 'ent-a', person_id: 'p-1', occurred_at: '2026-08-01T00:00:00Z',
      direction: 'out', channel: 'email', content: 'intro',
    };
    const db = makeDb({ entities: [entity], people: [person], interactions: [outbound] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('follow_up_overdue');
    expect(step.entityId).toBe('ent-a');
    expect(step.personId).toBe('p-1');
    expect(step.target).toBe('/entities/ent-a?rail=log&person=p-1');
  });

  it('3b: ties on days-overdue break by lower wave, then better fit', () => {
    const waveTwo = makeEntity({ id: 'ent-wave2', status: 'contacted', wave: 2, fit_score: 'high' });
    const waveOne = makeEntity({ id: 'ent-wave1', status: 'contacted', wave: 1, fit_score: 'low' });
    const p2 = makePerson({ id: 'p-wave2', entity_id: 'ent-wave2', seniority_rank: 1, full_name: 'Wave Two Contact' });
    const p1 = makePerson({ id: 'p-wave1', entity_id: 'ent-wave1', seniority_rank: 1, full_name: 'Wave One Contact' });
    const sameDay = '2026-08-01T00:00:00Z';
    const db = makeDb({
      entities: [waveTwo, waveOne], people: [p2, p1],
      interactions: [
        { id: 'i-1', entity_id: 'ent-wave2', person_id: 'p-wave2', occurred_at: sameDay, direction: 'out', channel: 'email', content: 'hi' },
        { id: 'i-2', entity_id: 'ent-wave1', person_id: 'p-wave1', occurred_at: sameDay, direction: 'out', channel: 'email', content: 'hi' },
      ],
    });

    const step = sherlockNext(db, NOW);
    expect(step.entityId).toBe('ent-wave1'); // lower wave wins even though its fit is worse
  });

  it('4: a task due today, once nothing higher-priority applies', () => {
    const task: TaskItem = {
      id: 't-today', title: 'Send the follow-up deck', due_at: '2026-08-27T09:00:00Z',
      kind: 'admin', action_type: 'other', done: false,
    };
    const db = makeDb({ tasks: [task] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('task_due_today');
    expect(step.label).toContain('Send the follow-up deck');
  });

  it('4b: a task due tomorrow does not count as due today', () => {
    const task: TaskItem = {
      id: 't-tomorrow', title: 'Not yet', due_at: '2026-08-28T09:00:00Z',
      kind: 'admin', action_type: 'other', done: false,
    };
    const db = makeDb({ tasks: [task] });

    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });

  it('5: ready to contact — pre-flight green, once nothing more urgent applies', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital' });
    const person = makePerson({ id: 'p-1', entity_id: 'ent-a', seniority_rank: 1, full_name: 'Marta Zanchi' });
    const db = makeDb({ entities: [entity], people: [person] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('ready_to_contact');
    expect(step.entityId).toBe('ent-a');
    expect(step.personId).toBe('p-1');
  });

  it('5b: caps reached blocks step 5 even with a ready contact available', () => {
    const entity = makeEntity({ id: 'ent-a' });
    const person = makePerson({ id: 'p-1', entity_id: 'ent-a', seniority_rank: 1 });
    // org.daily_cap = 5 by default; five outbound touches today exhausts it.
    const today = NOW.toISOString();
    const otherEntity = makeEntity({ id: 'ent-b', status: 'contacted' });
    const otherPerson = makePerson({ id: 'p-2', entity_id: 'ent-b', seniority_rank: 1 });
    const outbounds: Interaction[] = Array.from({ length: 5 }, (_, i) => ({
      id: `i-${i}`, entity_id: 'ent-b', person_id: 'p-2', occurred_at: today,
      direction: 'out' as const, channel: 'email' as const, content: `msg ${i}`,
    }));
    const db = makeDb({ entities: [entity, otherEntity], people: [person, otherPerson], interactions: outbounds });

    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });

  it('6: all clear on a fully empty store', () => {
    const step = sherlockNext(makeDb(), NOW);
    expect(step.kind).toBe('all_clear');
    expect(step.target).toBe('/today');
  });

  it('respects the full priority order: interest request beats an available ready-to-contact', () => {
    const readyEntity = makeEntity({ id: 'ent-ready' });
    const readyPerson = makePerson({ id: 'p-ready', entity_id: 'ent-ready', seniority_rank: 1 });
    const interestTask: TaskItem = {
      id: 't-interest', title: 'An investor requested contact access', due_at: '2026-08-01T00:00:00Z',
      entity_id: 'ent-other', kind: 'follow_up', action_type: 'follow_up_thread', done: false,
      source: 'interest_level_request',
    };
    const db = makeDb({ entities: [readyEntity], people: [readyPerson], tasks: [interestTask] });

    expect(sherlockNext(db, NOW).kind).toBe('interest_request');
  });
});
