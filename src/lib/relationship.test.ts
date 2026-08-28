import { describe, expect, it } from 'vitest';
import { followUpTaskDisplayTitle, relationshipSummary, suggestNextAction } from './relationship';
import type { Db, Entity, Interaction, TaskItem } from './types';

const OCCURRED = '2026-07-30T10:00:00.000Z';

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

function makeDb(entities: Entity[], interactions: Interaction[] = []): Db {
  return {
    catalog: [], packs: [], unlocks: [], submissions: [],
    org: { id: 'org-1', name: 'ablute_', plan: 'idea', daily_cap: 5, weekly_cap: 20 },
    entities, people: [], personAffiliations: [], interactions,
    tasks: [], relationshipState: [], overrides: [], folders: [], documents: [],
    grants: [], views: [], templates: [], automations: [], runs: [], aiReviews: [], companyFacts: [], ndas: [], documentVersions: [], reawakeningProposals: [],
    companyPeople: [], tractionMetrics: [], roadmapMilestones: [], fundingRounds: [], roadmapCategories: [], roadmapEvents: [], rejectionCodes: [], interactionEdits: [], orgAxisClassifications: [],
    interactionDocuments: [],
  };
}

describe('relationshipSummary — Prompt 197 C.1 (deal_messages merge)', () => {
  const now = new Date('2026-08-15T12:00:00.000Z');
  const entity = makeEntity({ id: 'ent-1', name: 'Acme Capital' });

  it('behaves exactly as before when dealMessageTouches is omitted', () => {
    const db = makeDb([entity], [
      makeInteraction({ id: 'i1', entity_id: 'ent-1', occurred_at: '2026-08-01T00:00:00.000Z', direction: 'out' }),
    ]);
    const s = relationshipSummary(db, 'ent-1', now);
    expect(s.whoseTurn).toBe('overdue'); // outbound, >14d ago, no reply on record
    expect(s.touchCount).toBe(1);
  });

  it('a Sherlock message from the investor counts as their turn — founder owes a reply', () => {
    const db = makeDb([entity], [
      makeInteraction({ id: 'i1', entity_id: 'ent-1', occurred_at: '2026-08-01T00:00:00.000Z', direction: 'out' }),
    ]);
    const s = relationshipSummary(db, 'ent-1', now, [
      { occurredAt: '2026-08-14T00:00:00.000Z', direction: 'in' },
    ]);
    expect(s.whoseTurn).toBe('us');
    expect(s.lastTouchAt).toBe('2026-08-14T00:00:00.000Z');
    expect(s.touchCount).toBe(2);
  });

  it('a Sherlock message from the founder themselves still counts as outbound (their move, waiting on a reply)', () => {
    const db = makeDb([entity], []);
    const s = relationshipSummary(db, 'ent-1', now, [
      { occurredAt: '2026-08-14T00:00:00.000Z', direction: 'out' },
    ]);
    expect(s.whoseTurn).toBe('them');
    expect(s.touchCount).toBe(1);
  });

  it('interleaves manual interactions and Sherlock messages by actual timestamp, not by source', () => {
    const db = makeDb([entity], [
      makeInteraction({ id: 'i1', entity_id: 'ent-1', occurred_at: '2026-08-10T00:00:00.000Z', direction: 'out' }),
    ]);
    const s = relationshipSummary(db, 'ent-1', now, [
      { occurredAt: '2026-08-05T00:00:00.000Z', direction: 'in' }, // earlier than the interaction above
    ]);
    // the later touch (the manually-logged outbound one) determines whoseTurn
    expect(s.lastTouchAt).toBe('2026-08-10T00:00:00.000Z');
    expect(s.touchCount).toBe(2);
  });
});

describe('suggestNextAction', () => {
  it('suggests a 14-day wait-then-follow-up for an outbound web form submission', () => {
    const s = suggestNextAction('out', 'web_form', undefined, OCCURRED);
    expect(s).not.toBeNull();
    expect(s!.actionType).toBe('follow_up_no_reply');
    expect(s!.dueAt.slice(0, 10)).toBe('2026-08-13'); // +14 days
    expect(s!.title).toContain('follow up via the same form');
  });

  it('suggests a shorter window for a meeting, tagged follow_up_thread', () => {
    const s = suggestNextAction('out', 'meeting', undefined, OCCURRED);
    expect(s!.actionType).toBe('follow_up_thread');
    expect(s!.dueAt.slice(0, 10)).toBe('2026-08-01'); // +2 days
  });

  it('suggests scheduling a meeting for an inbound meeting_request', () => {
    const s = suggestNextAction('in', 'email', 'meeting_request', OCCURRED);
    expect(s!.title).toBe('Schedule the meeting');
    expect(s!.actionType).toBe('follow_up_thread');
  });

  it('returns null for an inbound pass — the relationship is closed, not awaiting a next step', () => {
    expect(suggestNextAction('in', 'email', 'pass', OCCURRED)).toBeNull();
  });

  it('returns null for an inbound classification with no rule (e.g. unclear)', () => {
    expect(suggestNextAction('in', 'email', 'unclear', OCCURRED)).toBeNull();
  });

  it('returns null for an outbound channel with no rule (e.g. stage_change)', () => {
    expect(suggestNextAction('out', 'stage_change', undefined, OCCURRED)).toBeNull();
  });
});

describe('followUpTaskDisplayTitle — Prompt 414 §1', () => {
  function makeTask(overrides: Partial<TaskItem> = {}): TaskItem {
    return {
      id: 't1', title: 'Wait for a reply until 2026-08-20 — then follow up on the introduction',
      due_at: '2026-08-20T00:00:00.000Z', kind: 'follow_up', action_type: 'follow_up_no_reply', done: false,
      ...overrides,
    };
  }

  it('before the deadline, the title is unchanged', () => {
    const t = makeTask();
    expect(followUpTaskDisplayTitle(t, new Date('2026-08-15T00:00:00.000Z'))).toBe(t.title);
  });

  it('at the exact deadline, it already switches to the present-tense form', () => {
    const t = makeTask();
    expect(followUpTaskDisplayTitle(t, new Date('2026-08-20T00:00:00.000Z')))
      .toBe('No reply since 2026-08-20 — follow up on the introduction');
  });

  it('long after the deadline, it keeps switching (not just on the first overdue day)', () => {
    const t = makeTask();
    expect(followUpTaskDisplayTitle(t, new Date('2026-09-15T00:00:00.000Z')))
      .toBe('No reply since 2026-08-20 — follow up on the introduction');
  });

  it('a follow_up_thread task (e.g. a channel like call/meeting/event) gets the same treatment', () => {
    const t = makeTask({
      title: 'Wait for a reply until 2026-08-10 — then follow up after the meeting',
      due_at: '2026-08-10T00:00:00.000Z', action_type: 'follow_up_thread',
    });
    expect(followUpTaskDisplayTitle(t, new Date('2026-08-25T00:00:00.000Z')))
      .toBe('No reply since 2026-08-10 — follow up after the meeting');
  });

  it('leaves an INBOUND-suggested title untouched — same kind/action_type/due_at shape, different template', () => {
    // Confirmed via RailLogForm.tsx's acceptSuggestion(): an inbound
    // classification like 'meeting_request' saves through the exact same
    // {kind:'follow_up', action_type:'follow_up_thread', due_at} shape as
    // an outbound suggestion — only the title's own literal prefix tells
    // them apart, which is why this is the real discriminant, not those
    // three fields.
    const t = makeTask({ title: 'Schedule the meeting', due_at: '2026-08-01T00:00:00.000Z', action_type: 'follow_up_thread' });
    expect(followUpTaskDisplayTitle(t, new Date('2026-09-01T00:00:00.000Z'))).toBe('Schedule the meeting');
  });

  it('leaves a research/admin/meeting-kind task untouched regardless of title', () => {
    const t = makeTask({ kind: 'admin', due_at: '2026-08-01T00:00:00.000Z' });
    expect(followUpTaskDisplayTitle(t, new Date('2026-09-01T00:00:00.000Z'))).toBe(t.title);
  });

  it('leaves a task with no due_at untouched', () => {
    const t = makeTask({ due_at: undefined });
    expect(followUpTaskDisplayTitle(t, new Date('2026-09-01T00:00:00.000Z'))).toBe(t.title);
  });

  it('leaves a hand-edited title that no longer matches the exact template untouched', () => {
    const t = makeTask({ title: 'Wait for a reply until 2026-08-20, then call them' }); // no " — " separator
    expect(followUpTaskDisplayTitle(t, new Date('2026-09-01T00:00:00.000Z'))).toBe(t.title);
  });
});
