import { describe, expect, it } from 'vitest';
import { liveOverdueEntities, sherlockNext, sherlockNextClueCopy, sherlockNextSnoozeKey } from './sherlock-next';
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

// Prompt 417 §A.1 — the original bare-minimum org (no isProfileGateComplete
// field set) is now its own named fixture rather than makeDb()'s default:
// every pre-417 test that doesn't care about onboarding needs a COMPLETE
// profile by default (below) so steps 5-8 don't intercept it; the tests
// that specifically exercise onboarding_profile use this one directly.
const INCOMPLETE_ORG: Db['org'] = { id: 'org-1', name: 'ablute_', plan: 'idea', daily_cap: 5, weekly_cap: 20 };
const COMPLETE_ORG: Db['org'] = {
  ...INCOMPLETE_ORG,
  website: 'https://ablute.example', sectors: ['healthtech'], stage: 'seed', country: 'PT',
  round_target_eur: 1_300_000, current_phase: 'pilot', founded_year: 2023, revenue_eur: 0,
  primary_contact_person_id: 'founder-1',
};
// A small, varied Vault — comfortably clears vaultStrength's 'Thin' (<0.3)
// AND 'Reasonable' (<0.5) bands (lands around 'Strong', ~0.62), so tests
// exercising steps 9-12 don't accidentally trip readiness_nudge just for
// using makeDb()'s default documents. The dedicated readiness_nudge test
// below overrides `documents` with a single generic one instead, which
// this same barometer scores as genuinely 'Thin'.
const HEALTHY_VAULT_DOCS: Db['documents'] = [
  { id: 'doc-deck', name: 'Pitch deck', is_view_only: false, visibility: 'open', watermark: false, downloadable: true },
  { id: 'doc-captable', name: 'Cap table', is_view_only: false, visibility: 'open', watermark: false, downloadable: true },
  { id: 'doc-loi', name: 'Signed customer agreement', is_view_only: false, visibility: 'open', watermark: false, downloadable: true },
  { id: 'doc-model', name: 'Financial model', is_view_only: false, visibility: 'open', watermark: false, downloadable: true },
];
// An entity with NO people attached — satisfies "at least one entity
// exists" (step 7) without ever being eligible for step 3 (needs a person
// to reply to) or step 9 (readyToContact iterates db.people, not entities)
// — a bypass that's genuinely inert everywhere else in the ladder.
const BYPASS_ENTITY = makeEntity({ id: 'ent-bypass' });
// entity_id deliberately doesn't match any real entity above — step 8's
// own check (db.interactions.some direction==='out') is global, and
// nothing else in the ladder resolves an entity FROM an interaction, so a
// dangling entity_id here is inert everywhere except the one gate it
// exists to satisfy. Dated well outside any cap/lock window around NOW.
const BYPASS_OUTBOUND: Interaction = {
  id: 'i-bypass-outbound', entity_id: 'ent-nonexistent', occurred_at: '2020-01-01T00:00:00Z',
  direction: 'out', channel: 'email', content: 'bypass',
};

function makeDb(overrides: Partial<Db> = {}): Db {
  return {
    catalog: [], packs: [], unlocks: [], submissions: [],
    org: COMPLETE_ORG,
    entities: [], people: [], personAffiliations: [], interactions: [],
    tasks: [], relationshipState: [], overrides: [], folders: [], documents: HEALTHY_VAULT_DOCS,
    grants: [], views: [], templates: [], automations: [], runs: [], aiReviews: [], companyFacts: [], ndas: [], documentVersions: [], reawakeningProposals: [],
    companyPeople: [], tractionMetrics: [], roadmapMilestones: [], fundingRounds: [], roadmapCategories: [], roadmapEvents: [], rejectionCodes: [], interactionEdits: [], orgAxisClassifications: [],
    interactionDocuments: [], sherlockNextSnoozes: [], entityReopenSnapshots: [], capTableEntries: [],
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
    expect(step.target).toBe('/entities/ent-a?focus=interest');
    expect(step.label).toContain('Nina Capital');
  });

  it('1c: a pending interest request with no entity_id falls back to /today', () => {
    const task: TaskItem = {
      id: 't-1', title: 'An investor requested contact access', due_at: '2026-08-20T00:00:00Z',
      kind: 'follow_up', action_type: 'follow_up_thread', done: false,
      source: 'interest_level_request',
    };
    const db = makeDb({ tasks: [task] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('interest_request');
    expect(step.target).toBe('/today');
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

  it('2: a pending cap table request (item_type marker), once no interest request is pending', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital' });
    const task: TaskItem = {
      id: 't-cap', title: 'Document request: 1 item', due_at: '2026-08-20T00:00:00Z',
      entity_id: 'ent-a', kind: 'follow_up', action_type: 'follow_up_thread', done: false,
      source: 'document_request', notes: 'priority:tier2|request:req-1|item_type:cap_table',
    };
    const db = makeDb({ entities: [entity], tasks: [task] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('cap_table_request');
    expect(step.target).toBe('/settings?tab=company');
    expect(step.label).toBe('Next: add your cap table for Nina Capital');
    expect(step.taskId).toBe('t-cap');
  });

  it('2b: a document_request task with NO item_type marker is not treated as a cap table request', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital' });
    const person = makePerson({ id: 'p-1', entity_id: 'ent-a', seniority_rank: 1 });
    const task: TaskItem = {
      id: 't-doc', title: 'Document request: 1 item', due_at: '2026-08-20T00:00:00Z',
      entity_id: 'ent-a', kind: 'follow_up', action_type: 'follow_up_thread', done: false,
      source: 'document_request', notes: 'priority:tier2|request:req-2',
    };
    // No unclassified reply/overdue/etc. either — falls through to
    // task_due_today only if due today; due_at here is in the past (not
    // today), so this specific fixture actually reaches all_clear-ish
    // territory — the point under test is just that step 2 doesn't fire.
    const db = makeDb({ entities: [entity], people: [person], tasks: [task] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).not.toBe('cap_table_request');
  });

  it('2c: interest_request (step 1) still wins over a pending cap table request', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital' });
    const interestTask: TaskItem = {
      id: 't-interest', title: 'Nina Capital requested contact access', due_at: '2026-08-20T00:00:00Z',
      entity_id: 'ent-a', kind: 'follow_up', action_type: 'follow_up_thread', done: false,
      source: 'interest_level_request',
    };
    const capTableTask: TaskItem = {
      id: 't-cap', title: 'Document request: 1 item', due_at: '2026-08-19T00:00:00Z',
      entity_id: 'ent-a', kind: 'follow_up', action_type: 'follow_up_thread', done: false,
      source: 'document_request', notes: 'priority:tier2|request:req-1|item_type:cap_table',
    };
    const db = makeDb({ entities: [entity], tasks: [interestTask, capTableTask] });

    expect(sherlockNext(db, NOW).kind).toBe('interest_request');
  });

  it('3: oldest unclassified reply, once no interest/cap-table request is pending', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital' });
    const reply: Interaction = {
      id: 'i-1', entity_id: 'ent-a', occurred_at: '2026-08-20T00:00:00Z',
      direction: 'in', channel: 'email', content: 'hi', classification: undefined,
    };
    const db = makeDb({ entities: [entity], interactions: [reply] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('unclassified_reply');
    expect(step.entityId).toBe('ent-a');
    expect(step.target).toBe('/entities/ent-a?rail=history&classify=1&focus=unclassified_reply');
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
    // BYPASS_OUTBOUND only satisfies step 8 (has SOMETHING ever been sent
    // org-wide) — it isn't otherwise related to what this test checks.
    const db = makeDb({ entities: [entity], interactions: [reply, BYPASS_OUTBOUND] });

    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });

  it('4: the most overdue follow-up, once nothing pending/unclassified remains', () => {
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
    expect(step.target).toBe('/entities/ent-a?rail=log&person=p-1&focus=follow_up_overdue');
  });

  it('4b: ties on days-overdue break by lower wave, then better fit', () => {
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

  it('5: a task due today, once nothing higher-priority applies', () => {
    const task: TaskItem = {
      id: 't-today', title: 'Send the follow-up deck', due_at: '2026-08-27T09:00:00Z',
      kind: 'admin', action_type: 'other', done: false,
    };
    const db = makeDb({ tasks: [task] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('task_due_today');
    expect(step.label).toContain('Send the follow-up deck');
  });

  it('5b: a task due tomorrow does not count as due today', () => {
    const task: TaskItem = {
      id: 't-tomorrow', title: 'Not yet', due_at: '2026-08-28T09:00:00Z',
      kind: 'admin', action_type: 'other', done: false,
    };
    // Bypasses onboarding (profile/docs come from makeDb()'s own healthy
    // defaults already) so this isolates step 5's date-window logic
    // specifically.
    const db = makeDb({ tasks: [task], entities: [BYPASS_ENTITY], interactions: [BYPASS_OUTBOUND] });

    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });

  // Prompt 425 §A — regression coverage for the bug Prompt 414 §1's own
  // "grep final" missed and Prompt 415 §2 fixed as a natural extension of
  // being back in this exact code area (see this file's own comment right
  // above the fix, in sherlock-next.ts's step 5): a follow_up-kind task
  // whose title still carries the frozen "Wait for a reply until <date> —
  // then <verb>" template, due earlier TODAY (so the deadline has already
  // passed), must come back through the ladder already rewritten to "No
  // reply since <date> — <verb>" — never the stale literal. Every existing
  // task_due_today test above uses a plain admin-kind title with no such
  // prefix, so none of them ever exercised this branch — confirmed by
  // reading them before writing this one.
  it('5c: a task due today with a frozen "Wait for a reply" title comes back already rewritten', () => {
    const task: TaskItem = {
      id: 't-frozen', title: 'Wait for a reply until 2026-08-27 — then follow up by email',
      due_at: '2026-08-27T09:00:00Z', kind: 'follow_up', action_type: 'follow_up_no_reply', done: false,
    };
    const db = makeDb({ tasks: [task] });

    const step = sherlockNext(db, NOW); // NOW is 2026-08-27T12:00:00Z — after the 09:00 due time, same day
    expect(step.kind).toBe('task_due_today');
    expect(step.label).toBe('Next: No reply since 2026-08-27 — follow up by email');
    expect(step.label).not.toContain('Wait for a reply');
  });

  it('6: onboarding — incomplete company profile, once nothing from steps 1-5 applies', () => {
    const db = makeDb({ org: INCOMPLETE_ORG });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('onboarding_profile');
    expect(step.target).toBe('/settings');
  });

  it('7: onboarding — no documents in the data room, once the profile is complete', () => {
    const db = makeDb({ documents: [] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('onboarding_dataroom');
    expect(step.target).toBe('/documents');
  });

  it('8: onboarding — empty pipeline, once profile and data room are in place', () => {
    const step = sherlockNext(makeDb(), NOW); // COMPLETE_ORG + HEALTHY_VAULT_DOCS by default, zero entities

    expect(step.kind).toBe('onboarding_pipeline');
    expect(step.target).toBe('/pipeline');
  });

  it('9: onboarding — first message, an entity exists but nothing has ever been sent', () => {
    // Prompt 544 Part D — both entities now carry a channel. Before that
    // rule a bare entity qualified, which is exactly how the founder got
    // "send your first message to Hoxton Ventures" for a firm with nobody to
    // write to. The test's original point is untouched: insertion order
    // deliberately doesn't match priority order, so the sort has to be doing
    // the work.
    const bestFit = makeEntity({ id: 'ent-best', name: 'Best Fit', wave: 1, fit_score: 'high', email: 'hello@best.example' });
    const lowerPriority = makeEntity({ id: 'ent-other', name: 'Lower Priority', wave: 3, fit_score: 'low', email: 'hello@other.example' });
    const db = makeDb({ entities: [lowerPriority, bestFit] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('onboarding_first_message');
    expect(step.entityId).toBe('ent-best');
  });

  it('9: never names an entity with nobody to contact and no channel', () => {
    // The Hoxton case, exactly: wave 1, best fit, zero people, no form, no
    // inbox. It must not be chosen, and with nothing else actionable the
    // step must not be invented at all.
    const empty = makeEntity({ id: 'ent-empty', name: 'Hoxton Ventures', wave: 1, fit_score: 'high' });
    const step = sherlockNext(makeDb({ entities: [empty] }), NOW);
    expect(step.kind).not.toBe('onboarding_first_message');
  });

  it('9: prefers a reachable entity over a better-fitting empty one', () => {
    const empty = makeEntity({ id: 'ent-empty', name: 'Hoxton Ventures', wave: 1, fit_score: 'high' });
    const reachable = makeEntity({ id: 'ent-reach', name: 'DOMiNO Ventures', wave: 1, fit_score: 'medium', email: 'hello@domino.example' });
    const step = sherlockNext(makeDb({ entities: [empty, reachable] }), NOW);
    expect(step.kind).toBe('onboarding_first_message');
    expect(step.entityId).toBe('ent-reach');
  });

  it('10: ready to contact — pre-flight green, once nothing more urgent (including onboarding) applies', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital' });
    const person = makePerson({ id: 'p-1', entity_id: 'ent-a', seniority_rank: 1, full_name: 'Marta Zanchi' });
    // Without SOME prior outbound somewhere, step 8 (onboarding_first_message)
    // would fire first — BYPASS_OUTBOUND satisfies it without touching this
    // candidate's own not_contacted status or preflight.
    const db = makeDb({ entities: [entity], people: [person], interactions: [BYPASS_OUTBOUND] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('ready_to_contact');
    expect(step.entityId).toBe('ent-a');
    expect(step.personId).toBe('p-1');
  });

  it('10b: caps reached blocks step 10 even with a ready contact available', () => {
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

  it('11: pitch review — 3+ passes on the same reason, once nothing from steps 1-10 is pending', () => {
    const passed = ['ent-p1', 'ent-p2', 'ent-p3'].map((id) => makeEntity({ id, status: 'passed' }));
    const passes: Interaction[] = passed.map((e, i) => ({
      id: `i-pass-${i}`, entity_id: e.id, occurred_at: '2026-08-10T00:00:00Z',
      direction: 'in', channel: 'email', content: 'no thanks',
      classification: 'pass', pass_reason: 'not our stage', pass_reason_category: 'stage_too_early',
    }));
    const db = makeDb({ entities: passed, interactions: [...passes, BYPASS_OUTBOUND] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('pitch_review');
    expect(step.target).toBe('/dashboard');
  });

  it('12: readiness nudge — thin vault, once nothing from steps 1-11 applies', () => {
    // A single, generically-named document — vaultStrength scores this
    // 'Thin' (~0.27, under the 0.3 cutoff): low quantity, zero checklist
    // variety, 'summary'-tier importance. HEALTHY_VAULT_DOCS (the default)
    // is deliberately NOT used here — this test needs a genuinely thin one.
    const thinDoc = { id: 'doc-thin', name: 'Company overview', is_view_only: false, visibility: 'open' as const, watermark: false, downloadable: true };
    const db = makeDb({ documents: [thinDoc], entities: [BYPASS_ENTITY], interactions: [BYPASS_OUTBOUND] });

    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('readiness_nudge');
    expect(step.target).toBe('/readiness?tab=plan');
  });

  it('13: all clear once everything — onboarding included — is genuinely caught up', () => {
    const db = makeDb({ entities: [BYPASS_ENTITY], interactions: [BYPASS_OUTBOUND] });

    const step = sherlockNext(db, NOW);
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

  // Prompt 417 — the two critical cases the prompt's own verification
  // section names explicitly: onboarding (§A) never blocks a real pending
  // signal above it, and real contact (steps 1-9) never falls behind
  // evaluate/train (§B) — Nuno's "50% rule", enforced as ORDER here, not
  // hope.
  it('critical: an incomplete onboarding never blocks a pending interest request — the request always wins', () => {
    const interestTask: TaskItem = {
      id: 't-interest', title: 'An investor requested contact access', due_at: '2026-08-20T00:00:00Z',
      entity_id: 'ent-a', kind: 'follow_up', action_type: 'follow_up_thread', done: false,
      source: 'interest_level_request',
    };
    // Day-1 org: no profile, no documents, no pipeline — every onboarding
    // gate would fire if this task weren't here.
    const db = makeDb({ org: INCOMPLETE_ORG, documents: [], entities: [], tasks: [interestTask] });

    expect(sherlockNext(db, NOW).kind).toBe('interest_request');
  });

  it('critical: a ready-to-contact candidate always wins over an active pitch-review alert', () => {
    const passed = ['ent-p1', 'ent-p2', 'ent-p3'].map((id) => makeEntity({ id, status: 'passed' }));
    const passes: Interaction[] = passed.map((e, i) => ({
      id: `i-pass-${i}`, entity_id: e.id, occurred_at: '2026-08-10T00:00:00Z',
      direction: 'in', channel: 'email', content: 'no thanks',
      classification: 'pass', pass_reason: 'not our stage', pass_reason_category: 'stage_too_early',
    }));
    const readyEntity = makeEntity({ id: 'ent-ready' });
    const readyPerson = makePerson({ id: 'p-ready', entity_id: 'ent-ready', seniority_rank: 1 });
    // passReasonAlert(db) is genuinely true here (3 passes, same category) —
    // this isn't testing an inactive alert, it's testing that an active one
    // still loses to real contact.
    const db = makeDb({
      entities: [...passed, readyEntity], people: [readyPerson],
      interactions: [...passes, BYPASS_OUTBOUND],
    });

    expect(sherlockNext(db, NOW).kind).toBe('ready_to_contact');
  });
});

describe('liveOverdueEntities — Prompt 414 §2.2', () => {
  it('surfaces an overdue entity with no task at all', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital', status: 'contacted' });
    const person = makePerson({ id: 'p-1', entity_id: 'ent-a', seniority_rank: 1, full_name: 'Marta Zanchi' });
    const outbound: Interaction = {
      id: 'i-1', entity_id: 'ent-a', person_id: 'p-1', occurred_at: '2026-08-01T00:00:00Z',
      direction: 'out', channel: 'email', content: 'intro',
    };
    const db = makeDb({ entities: [entity], people: [person], interactions: [outbound] });

    const results = liveOverdueEntities(db, NOW);
    expect(results).toHaveLength(1);
    expect(results[0].entityId).toBe('ent-a');
    expect(results[0].personId).toBe('p-1');
    expect(results[0].text).toContain('Follow up');
  });

  it('dedupes: an entity in excludeEntityIds is skipped even though it is overdue', () => {
    const entity = makeEntity({ id: 'ent-a', status: 'contacted' });
    const person = makePerson({ id: 'p-1', entity_id: 'ent-a', seniority_rank: 1 });
    const outbound: Interaction = {
      id: 'i-1', entity_id: 'ent-a', person_id: 'p-1', occurred_at: '2026-08-01T00:00:00Z',
      direction: 'out', channel: 'email', content: 'intro',
    };
    const db = makeDb({ entities: [entity], people: [person], interactions: [outbound] });

    expect(liveOverdueEntities(db, NOW, new Set(['ent-a']))).toHaveLength(0);
  });

  it('a second overdue entity with no task appears alongside the first, excluded set only removes the one it names', () => {
    const overdueNoTask = makeEntity({ id: 'ent-live', status: 'contacted' });
    const overdueWithTask = makeEntity({ id: 'ent-task', status: 'contacted' });
    const p1 = makePerson({ id: 'p-live', entity_id: 'ent-live', seniority_rank: 1 });
    const p2 = makePerson({ id: 'p-task', entity_id: 'ent-task', seniority_rank: 1 });
    const sameDay = '2026-08-01T00:00:00Z';
    const db = makeDb({
      entities: [overdueNoTask, overdueWithTask], people: [p1, p2],
      interactions: [
        { id: 'i-1', entity_id: 'ent-live', person_id: 'p-live', occurred_at: sameDay, direction: 'out', channel: 'email', content: 'hi' },
        { id: 'i-2', entity_id: 'ent-task', person_id: 'p-task', occurred_at: sameDay, direction: 'out', channel: 'email', content: 'hi' },
      ],
    });

    // Only 'ent-task' is excluded (it already has an open task, per the
    // caller's own set) — 'ent-live' must still come through.
    const results = liveOverdueEntities(db, NOW, new Set(['ent-task']));
    expect(results.map((r) => r.entityId)).toEqual(['ent-live']);
  });

  it('excludes an entity whose turn it is NOT (whoseTurn "them", not overdue)', () => {
    const entity = makeEntity({ id: 'ent-a', status: 'contacted' });
    const person = makePerson({ id: 'p-1', entity_id: 'ent-a', seniority_rank: 1 });
    const recentOutbound: Interaction = {
      id: 'i-1', entity_id: 'ent-a', person_id: 'p-1', occurred_at: '2026-08-25T00:00:00Z', // 2 days ago, well inside LOCK_DAYS
      direction: 'out', channel: 'email', content: 'intro',
    };
    const db = makeDb({ entities: [entity], people: [person], interactions: [recentOutbound] });

    expect(liveOverdueEntities(db, NOW)).toHaveLength(0);
  });

  it('excludes a parked/closed entity even if its last touch is old', () => {
    const entity = makeEntity({ id: 'ent-a', status: 'dormant' });
    const person = makePerson({ id: 'p-1', entity_id: 'ent-a', seniority_rank: 1 });
    const outbound: Interaction = {
      id: 'i-1', entity_id: 'ent-a', person_id: 'p-1', occurred_at: '2026-06-01T00:00:00Z',
      direction: 'out', channel: 'email', content: 'intro',
    };
    const db = makeDb({ entities: [entity], people: [person], interactions: [outbound] });

    expect(liveOverdueEntities(db, NOW)).toHaveLength(0);
  });

  it('sorts by days-overdue desc, then lower wave, then better fit — same tie-break as step 3', () => {
    const older = makeEntity({ id: 'ent-older', status: 'contacted', wave: 3, fit_score: 'low' });
    const waveTwo = makeEntity({ id: 'ent-wave2', status: 'contacted', wave: 2, fit_score: 'high' });
    const waveOne = makeEntity({ id: 'ent-wave1', status: 'contacted', wave: 1, fit_score: 'low' });
    const people = [older, waveTwo, waveOne].map((e, i) => makePerson({ id: `p-${i}`, entity_id: e.id, seniority_rank: 1 }));
    const sameDay = '2026-08-01T00:00:00Z';
    const db = makeDb({
      entities: [waveTwo, waveOne, older], people,
      interactions: [
        { id: 'i-0', entity_id: 'ent-older', person_id: 'p-0', occurred_at: '2026-07-01T00:00:00Z', direction: 'out', channel: 'email', content: 'hi' },
        { id: 'i-1', entity_id: 'ent-wave2', person_id: 'p-1', occurred_at: sameDay, direction: 'out', channel: 'email', content: 'hi' },
        { id: 'i-2', entity_id: 'ent-wave1', person_id: 'p-2', occurred_at: sameDay, direction: 'out', channel: 'email', content: 'hi' },
      ],
    });

    const results = liveOverdueEntities(db, NOW);
    // ent-older has the most days overdue (touched a month earlier) → first;
    // ent-wave1/ent-wave2 tie on daysOverdue → lower wave (1) wins next.
    expect(results.map((r) => r.entityId)).toEqual(['ent-older', 'ent-wave1', 'ent-wave2']);
  });
});

describe('sherlockNext — snooze filtering (Prompt 415 §1.2)', () => {
  function snooze(overrides: Partial<Db['sherlockNextSnoozes'][number]> & { kind: string; snoozed_until: string }): Db['sherlockNextSnoozes'][number] {
    return { id: `snooze-${Math.random()}`, ...overrides };
  }
  const FUTURE = '2026-09-01T00:00:00Z'; // after NOW (2026-08-27) — still active
  const PAST = '2026-08-01T00:00:00Z'; // before NOW — already expired

  it('step 1: a snoozed interest-request task is skipped, falls through to all_clear when nothing else applies', () => {
    const task: TaskItem = {
      id: 't-1', title: 'An investor requested contact access', due_at: '2026-08-20T00:00:00Z',
      kind: 'follow_up', action_type: 'follow_up_thread', done: false, source: 'interest_level_request',
    };
    // BYPASS_ENTITY/BYPASS_OUTBOUND clear steps 7/8 (onboarding: pipeline,
    // first message) so falling through the snoozed step 1 genuinely
    // reaches all_clear, not the next onboarding step in line.
    const db = makeDb({
      entities: [BYPASS_ENTITY], interactions: [BYPASS_OUTBOUND], tasks: [task],
      sherlockNextSnoozes: [snooze({ kind: 'interest_request', task_id: 't-1', snoozed_until: FUTURE })],
    });

    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });

  it('step 1: an EXPIRED snooze does not filter — the task still wins', () => {
    const task: TaskItem = {
      id: 't-1', title: 'An investor requested contact access', due_at: '2026-08-20T00:00:00Z',
      kind: 'follow_up', action_type: 'follow_up_thread', done: false, source: 'interest_level_request',
    };
    const db = makeDb({ tasks: [task], sherlockNextSnoozes: [snooze({ kind: 'interest_request', task_id: 't-1', snoozed_until: PAST })] });

    expect(sherlockNext(db, NOW).kind).toBe('interest_request');
  });

  it('step 2: a snoozed cap table request is skipped, falls through to all_clear when nothing else applies', () => {
    const task: TaskItem = {
      id: 't-cap', title: 'Document request: 1 item', due_at: '2026-08-20T00:00:00Z',
      entity_id: 'ent-bypass', kind: 'follow_up', action_type: 'follow_up_thread', done: false,
      source: 'document_request', notes: 'priority:tier2|request:req-1|item_type:cap_table',
    };
    const db = makeDb({
      entities: [BYPASS_ENTITY], interactions: [BYPASS_OUTBOUND], tasks: [task],
      sherlockNextSnoozes: [snooze({ kind: 'cap_table_request', task_id: 't-cap', snoozed_until: FUTURE })],
    });

    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });

  it('step 2: an EXPIRED cap table snooze does not filter — the task still wins', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital' });
    const task: TaskItem = {
      id: 't-cap', title: 'Document request: 1 item', due_at: '2026-08-20T00:00:00Z',
      entity_id: 'ent-a', kind: 'follow_up', action_type: 'follow_up_thread', done: false,
      source: 'document_request', notes: 'priority:tier2|request:req-1|item_type:cap_table',
    };
    const db = makeDb({ entities: [entity], tasks: [task], sherlockNextSnoozes: [snooze({ kind: 'cap_table_request', task_id: 't-cap', snoozed_until: PAST })] });

    expect(sherlockNext(db, NOW).kind).toBe('cap_table_request');
  });

  it('step 3: a snoozed unclassified reply is skipped', () => {
    const entity = makeEntity({ id: 'ent-a' });
    const reply: Interaction = {
      id: 'i-1', entity_id: 'ent-a', occurred_at: '2026-08-20T00:00:00Z',
      direction: 'in', channel: 'email', content: 'hi', classification: undefined,
    };
    // BYPASS_OUTBOUND clears step 8 (onboarding: first message) — the
    // reply above is inbound, so it doesn't satisfy "ever sent outbound"
    // on its own; entities already has one (step 7 clear).
    const db = makeDb({
      entities: [entity], interactions: [reply, BYPASS_OUTBOUND],
      sherlockNextSnoozes: [snooze({ kind: 'unclassified_reply', interaction_id: 'i-1', snoozed_until: FUTURE })],
    });

    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });

  it('step 3: snoozing the MOST overdue entity falls through to the SECOND most overdue, not straight to all_clear', () => {
    const mostOverdue = makeEntity({ id: 'ent-most', status: 'contacted' });
    const secondOverdue = makeEntity({ id: 'ent-second', status: 'contacted' });
    const p1 = makePerson({ id: 'p-most', entity_id: 'ent-most', seniority_rank: 1 });
    const p2 = makePerson({ id: 'p-second', entity_id: 'ent-second', seniority_rank: 1 });
    const db = makeDb({
      entities: [mostOverdue, secondOverdue], people: [p1, p2],
      interactions: [
        { id: 'i-most', entity_id: 'ent-most', person_id: 'p-most', occurred_at: '2026-07-01T00:00:00Z', direction: 'out', channel: 'email', content: 'hi' },
        { id: 'i-second', entity_id: 'ent-second', person_id: 'p-second', occurred_at: '2026-07-15T00:00:00Z', direction: 'out', channel: 'email', content: 'hi' },
      ],
      sherlockNextSnoozes: [snooze({ kind: 'follow_up_overdue', entity_id: 'ent-most', snoozed_until: FUTURE })],
    });

    // Unsnoozed: ent-most (touched earliest, most overdue) would win.
    const unsnoozedStep = sherlockNext({ ...db, sherlockNextSnoozes: [] }, NOW);
    expect(unsnoozedStep.entityId).toBe('ent-most');

    // Snoozed: the loop skips ent-most entirely and lands on ent-second —
    // never falls straight to all_clear just because the TOP pick is out.
    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('follow_up_overdue');
    expect(step.entityId).toBe('ent-second');
  });

  it('step 4: a snoozed task-due-today is skipped', () => {
    const task: TaskItem = {
      id: 't-today', title: 'Send the follow-up deck', due_at: '2026-08-27T09:00:00Z',
      kind: 'admin', action_type: 'other', done: false,
    };
    const db = makeDb({
      entities: [BYPASS_ENTITY], interactions: [BYPASS_OUTBOUND], tasks: [task],
      sherlockNextSnoozes: [snooze({ kind: 'task_due_today', task_id: 't-today', snoozed_until: FUTURE })],
    });

    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });

  it('step 9: a snoozed ready-to-contact person is skipped', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital' });
    const person = makePerson({ id: 'p-1', entity_id: 'ent-a', seniority_rank: 1, full_name: 'Marta Zanchi' });
    const db = makeDb({
      entities: [entity, BYPASS_ENTITY], people: [person], interactions: [BYPASS_OUTBOUND],
      sherlockNextSnoozes: [snooze({ kind: 'ready_to_contact', person_id: 'p-1', snoozed_until: FUTURE })],
    });

    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });

  it('a snooze recorded for a DIFFERENT kind never filters — kind is always part of the match', () => {
    const task: TaskItem = {
      id: 't-today', title: 'Send the follow-up deck', due_at: '2026-08-27T09:00:00Z',
      kind: 'admin', action_type: 'other', done: false,
    };
    // Same task_id, but snoozed under the WRONG kind (interest_request, not
    // task_due_today) — must not accidentally filter step 4.
    const db = makeDb({ tasks: [task], sherlockNextSnoozes: [snooze({ kind: 'interest_request', task_id: 't-today', snoozed_until: FUTURE })] });

    expect(sherlockNext(db, NOW).kind).toBe('task_due_today');
  });
});

describe('sherlockNextClueCopy / sherlockNextSnoozeKey — Prompt 415 §2', () => {
  it('follow_up_overdue: reuses the live nextBestAction text, not the generic step.label', () => {
    const entity = makeEntity({ id: 'ent-a', status: 'contacted' });
    const person = makePerson({ id: 'p-1', entity_id: 'ent-a', seniority_rank: 1, full_name: 'Marta Zanchi' });
    const db = makeDb({
      entities: [entity], people: [person],
      interactions: [{ id: 'i-1', entity_id: 'ent-a', person_id: 'p-1', occurred_at: '2026-08-01T00:00:00Z', direction: 'out', channel: 'email', content: 'hi' }],
    });
    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('follow_up_overdue');
    expect(sherlockNextClueCopy(step, db, NOW)).toContain('Follow up');
    expect(sherlockNextClueCopy(step, db, NOW)).not.toBe(step.label);
  });

  it('cap_table_request: explains who asked and why (Prompt 423 §B.3)', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital' });
    const task: TaskItem = {
      id: 't-cap', title: 'Document request: 1 item', due_at: '2026-08-20T00:00:00Z',
      entity_id: 'ent-a', kind: 'follow_up', action_type: 'follow_up_thread', done: false,
      source: 'document_request', notes: 'priority:tier2|request:req-1|item_type:cap_table',
    };
    const db = makeDb({ entities: [entity], tasks: [task] });
    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('cap_table_request');
    expect(sherlockNextClueCopy(step, db, NOW)).toBe('Nina Capital asked for your cap table to estimate their stake — takes 2 minutes.');
  });

  it('a kind with no special case strips the "Next: " prefix from step.label', () => {
    const task: TaskItem = {
      id: 't-today', title: 'Send the follow-up deck', due_at: '2026-08-27T09:00:00Z',
      kind: 'admin', action_type: 'other', done: false,
    };
    const db = makeDb({ entities: [BYPASS_ENTITY], interactions: [BYPASS_OUTBOUND], tasks: [task] });
    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('task_due_today');
    expect(sherlockNextClueCopy(step, db, NOW)).toBe('Send the follow-up deck');
  });

  it('onboarding kinds also just strip the prefix (no crash, no special case needed)', () => {
    const db = makeDb({ org: INCOMPLETE_ORG });
    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('onboarding_profile');
    expect(sherlockNextClueCopy(step, db, NOW)).toBe('complete your company profile');
  });

  it('snooze key: task-keyed kinds resolve from step.taskId', () => {
    const task: TaskItem = {
      id: 't-1', title: 'An investor requested contact access', due_at: '2026-08-20T00:00:00Z',
      kind: 'follow_up', action_type: 'follow_up_thread', done: false, source: 'interest_level_request',
    };
    const db = makeDb({ tasks: [task] });
    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('interest_request');
    expect(sherlockNextSnoozeKey(step)).toEqual({ task_id: 't-1' });
  });

  it('snooze key: unclassified_reply resolves from step.interactionId', () => {
    const entity = makeEntity({ id: 'ent-a' });
    const reply: Interaction = { id: 'i-1', entity_id: 'ent-a', occurred_at: '2026-08-20T00:00:00Z', direction: 'in', channel: 'email', content: 'hi' };
    const db = makeDb({ entities: [entity], interactions: [reply] });
    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('unclassified_reply');
    expect(sherlockNextSnoozeKey(step)).toEqual({ interaction_id: 'i-1' });
  });

  it('snooze key: cap_table_request resolves from step.taskId', () => {
    const entity = makeEntity({ id: 'ent-a', name: 'Nina Capital' });
    const task: TaskItem = {
      id: 't-cap', title: 'Document request: 1 item', due_at: '2026-08-20T00:00:00Z',
      entity_id: 'ent-a', kind: 'follow_up', action_type: 'follow_up_thread', done: false,
      source: 'document_request', notes: 'priority:tier2|request:req-1|item_type:cap_table',
    };
    const db = makeDb({ entities: [entity], tasks: [task] });
    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('cap_table_request');
    expect(sherlockNextSnoozeKey(step)).toEqual({ task_id: 't-cap' });
  });

  it('snooze key: onboarding/pitch/readiness/all_clear kinds have none', () => {
    const db = makeDb({ org: INCOMPLETE_ORG });
    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('onboarding_profile');
    expect(sherlockNextSnoozeKey(step)).toBeNull();
  });
});

// Prompt 564 — local copies of 415's snooze helpers: they live inside that
// describe block's scope, and hoisting them would touch a passing test file
// for no reason.
function snooze564(overrides: Partial<Db['sherlockNextSnoozes'][number]> & { kind: string; snoozed_until: string }): Db['sherlockNextSnoozes'][number] {
  return { id: `snooze-${Math.random()}`, ...overrides };
}
const FUTURE_564 = '2026-09-01T00:00:00Z'; // after NOW — still active

// Prompt 564 — the Krohnsty shape, and the two rungs it exposed.
//
// Live on 04/09, org 70a354f2: 6 entities, ZERO people on every one of them,
// 1 outbound (COREangels Porto, locked to 18/09), 5 firms never approached —
// two of them in wave 1. The product said "All clear".
describe('sherlockNext — next_approach (Prompt 564 §C)', () => {
  const LOCKED_OUTBOUND: Interaction = {
    id: 'i-core', entity_id: 'ent-core', occurred_at: '2026-08-27T09:00:00Z',
    direction: 'out', channel: 'web_form', content: 'submitted',
  };

  /** A delivered catalog row: a channel, and no people at all. */
  function delivered(id: string, name: string, wave: number, extra: Partial<Entity> = {}): Entity {
    return makeEntity({ id, name, wave, email: `contact@${id}.example`, submission_channel_type: 'email', ...extra });
  }

  function krohnstyDb(overrides: Partial<Db> = {}): Db {
    return makeDb({
      entities: [
        delivered('ent-core', 'COREangels Porto', 1, { contact_lock_until: '2026-09-18T00:00:00Z', status: 'contacted' }),
        delivered('ent-newfund', 'Newfund', 1),
        delivered('ent-superangel', 'Superangel', 1),
        delivered('ent-mercia', 'Mercia Ventures', 2),
        delivered('ent-pv', 'Portugal Ventures', 2),
        delivered('ent-shilling', 'Shilling VC', 2),
      ],
      people: [],
      interactions: [LOCKED_OUTBOUND],
      ...overrides,
    });
  }

  // The bug, stated as a test: before 564 this returned 'all_clear'.
  it('names a wave-1 firm nobody has approached, instead of going silent', () => {
    const step = sherlockNext(krohnstyDb(), NOW);
    expect(step.kind).toBe('next_approach');
    expect(['ent-newfund', 'ent-superangel']).toContain(step.entityId);
    expect(step.label).toMatch(/Newfund|Superangel/);
    expect(step.kind).not.toBe('all_clear');
  });

  it('prefers wave 1 over wave 2', () => {
    const step = sherlockNext(krohnstyDb(), NOW);
    expect(['ent-mercia', 'ent-pv', 'ent-shilling']).not.toContain(step.entityId);
  });

  // A firm already written to belongs to step 4's follow-up path.
  it('never names a firm that already has an outbound', () => {
    for (let i = 0; i < 6; i++) {
      const step = sherlockNext(krohnstyDb(), NOW);
      expect(step.entityId).not.toBe('ent-core');
    }
  });

  it('falls through to the wave-2 rows once wave 1 is approached', () => {
    const db = krohnstyDb({
      interactions: [
        LOCKED_OUTBOUND,
        { id: 'i-nf', entity_id: 'ent-newfund', occurred_at: '2026-08-27T09:00:00Z', direction: 'out', channel: 'email', content: 'x' },
        { id: 'i-sa', entity_id: 'ent-superangel', occurred_at: '2026-08-27T09:00:00Z', direction: 'out', channel: 'email', content: 'x' },
      ],
    });
    const step = sherlockNext(db, NOW);
    expect(step.kind).toBe('next_approach');
    expect(['ent-mercia', 'ent-pv', 'ent-shilling']).toContain(step.entityId);
  });

  // Honest silence: every firm approached, nothing left to name.
  it('returns all_clear once every firm has been approached', () => {
    const db = krohnstyDb({
      interactions: ['ent-core', 'ent-newfund', 'ent-superangel', 'ent-mercia', 'ent-pv', 'ent-shilling']
        .map((id, i): Interaction => ({
          id: `i-${i}`, entity_id: id, occurred_at: '2026-08-27T09:00:00Z',
          direction: 'out', channel: 'email', content: 'x',
        })),
    });
    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });

  it('skips a contact-locked firm', () => {
    const db = krohnstyDb({
      entities: [
        delivered('ent-core', 'COREangels Porto', 1, { contact_lock_until: '2026-09-18T00:00:00Z', status: 'contacted' }),
        delivered('ent-newfund', 'Newfund', 1, { contact_lock_until: '2026-09-30T00:00:00Z' }),
        delivered('ent-superangel', 'Superangel', 1),
      ],
    });
    expect(sherlockNext(db, NOW).entityId).toBe('ent-superangel');
  });

  it('skips a snoozed firm, and the snooze is keyed on the entity', () => {
    const db = krohnstyDb({
      sherlockNextSnoozes: [snooze564({ kind: 'next_approach', entity_id: 'ent-newfund', snoozed_until: FUTURE_564 })],
    });
    const step = sherlockNext(db, NOW);
    expect(step.entityId).toBe('ent-superangel');
    expect(sherlockNextSnoozeKey({ ...step, kind: 'next_approach' })).toEqual({ entity_id: 'ent-superangel' });
  });

  // A row with neither a person nor a channel is an unfinished research job
  // of OURS; naming it would blame the founder for it.
  it('never names a firm with neither a person nor a channel', () => {
    const db = krohnstyDb({
      entities: [makeEntity({ id: 'ent-bare', name: 'Bare Co', wave: 1 })],
      interactions: [BYPASS_OUTBOUND],
    });
    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });
});

// Prompt 564 §D — an overdue task is still the next thing to do.
describe('sherlockNext — task_due_today covers overdue (Prompt 564 §D)', () => {
  function taskDue(due: string, id = 't-1'): TaskItem {
    return { id, title: 'Pick the right partner at Superangel and write your hook', due_at: due, kind: 'research', action_type: 'research_hook', done: false };
  }

  it('surfaces a task due today', () => {
    const db = makeDb({ tasks: [taskDue('2026-08-27T09:00:00Z')], entities: [BYPASS_ENTITY], interactions: [BYPASS_OUTBOUND] });
    expect(sherlockNext(db, NOW).kind).toBe('task_due_today');
  });

  // The bug: before 564 a task due yesterday vanished from the clue forever,
  // and no other rung covers overdue tasks.
  it('surfaces a task that was due yesterday', () => {
    const db = makeDb({ tasks: [taskDue('2026-08-26T09:00:00Z')], entities: [BYPASS_ENTITY], interactions: [BYPASS_OUTBOUND] });
    expect(sherlockNext(db, NOW).kind).toBe('task_due_today');
  });

  it('still ignores a task due tomorrow', () => {
    const db = makeDb({ tasks: [taskDue('2026-08-28T09:00:00Z')], entities: [BYPASS_ENTITY], interactions: [BYPASS_OUTBOUND] });
    expect(sherlockNext(db, NOW).kind).not.toBe('task_due_today');
  });

  it('takes the oldest overdue task first', () => {
    const db = makeDb({
      tasks: [taskDue('2026-08-26T09:00:00Z', 't-yesterday'), taskDue('2026-08-20T09:00:00Z', 't-week-ago')],
      entities: [BYPASS_ENTITY], interactions: [BYPASS_OUTBOUND],
    });
    expect(sherlockNext(db, NOW).taskId).toBe('t-week-ago');
  });

  // Regression guard for the hole widening the window opened: an
  // interest-request task is overdue the moment it is created, so without
  // the ownership check, snoozing step 1 would hand the same task to step 5
  // under a different kind and a different snooze key.
  it('never re-surfaces a task an earlier rung owns, even when overdue', () => {
    const interestTask: TaskItem = {
      id: 't-interest', title: 'Approve the interest request', due_at: '2026-08-20T09:00:00Z',
      kind: 'admin', action_type: 'other', done: false, source: 'interest_level_request',
    };
    const db = makeDb({
      tasks: [interestTask], entities: [BYPASS_ENTITY], interactions: [BYPASS_OUTBOUND],
      sherlockNextSnoozes: [snooze564({ kind: 'interest_request', task_id: 't-interest', snoozed_until: FUTURE_564 })],
    });
    expect(sherlockNext(db, NOW).kind).toBe('all_clear');
  });
});
