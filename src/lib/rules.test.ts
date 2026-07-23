import { describe, expect, it } from 'vitest';
import { buildFollowUpTask, LINKEDIN_NOTE_MAX, LOCK_DAYS, lintMessage, preflight } from './rules';
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
    org: { id: 'org-1', name: 'ablute_', plan: 'idea', daily_cap: 5, weekly_cap: 20 },
    entities, people, personAffiliations: [], interactions,
    tasks: [], relationshipState: [], overrides: [], folders: [], documents: [],
    grants: [], views: [], templates: [], automations: [], runs: [], aiReviews: [], companyFacts: [], ndas: [], documentVersions: [], reawakeningProposals: [],
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

// Founder-feedback batch 2, item 2 — LinkedIn connection-request notes are
// hard-capped by the platform itself at 300 characters, distinct from the
// (much looser, soft) DM cap.
describe('lintMessage — LinkedIn note length cap', () => {
  const person = makePerson({ id: 'p1', entity_id: 'e1', seniority_rank: 1 });

  it('errors when a linkedin_note draft exceeds LINKEDIN_NOTE_MAX', () => {
    const draft = 'x'.repeat(LINKEDIN_NOTE_MAX + 1);
    const findings = lintMessage(draft, person, undefined, 'linkedin_note');
    expect(findings.some((f) => f.severity === 'error' && f.message.includes(String(LINKEDIN_NOTE_MAX)))).toBe(true);
  });

  it('does not flag a linkedin_note draft within the cap', () => {
    const draft = 'Short note, well within the cap.';
    const findings = lintMessage(draft, person, undefined, 'linkedin_note');
    expect(findings.some((f) => f.severity === 'error' && f.message.includes(String(LINKEDIN_NOTE_MAX)))).toBe(false);
  });

  it('does not apply the note cap to a linkedin_dm draft', () => {
    const draft = 'x'.repeat(LINKEDIN_NOTE_MAX + 1); // over the note cap, well under the DM cap
    const findings = lintMessage(draft, person, undefined, 'linkedin_dm');
    expect(findings.some((f) => f.severity === 'error')).toBe(false);
  });
});

// Founder-feedback batch 2, item 2 — extracted from the (previously
// duplicated, in both store providers) inline object literal so the
// follow-up-commitment shape every outbound logInteraction creates is
// tested once, directly.
describe('buildFollowUpTask', () => {
  it('creates a follow_up_no_reply task due exactly LOCK_DAYS after the interaction', () => {
    const occurredAt = '2026-01-01T00:00:00.000Z';
    const task = buildFollowUpTask('ent-1', 'p-1', 'Acme Ventures', 'Jane Doe', occurredAt);
    expect(task.kind).toBe('follow_up');
    expect(task.action_type).toBe('follow_up_no_reply');
    expect(task.entity_id).toBe('ent-1');
    expect(task.person_id).toBe('p-1');
    expect(task.title).toBe('Follow up Jane Doe (Acme Ventures)');
    const dueMs = new Date(task.due_at!).getTime();
    const expectedMs = new Date(occurredAt).getTime() + LOCK_DAYS * 24 * 3600 * 1000;
    expect(dueMs).toBe(expectedMs);
  });

  it('still produces a usable title and no person_id when there is no person', () => {
    const task = buildFollowUpTask('ent-1', undefined, 'Acme Ventures', undefined, '2026-01-01T00:00:00.000Z');
    expect(task.title).toContain('Acme Ventures');
    expect(task.person_id).toBeUndefined();
  });
});
