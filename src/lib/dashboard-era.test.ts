// Prompt 361 — pure tests for the Before/With Sherlock era split.
import { describe, expect, it } from 'vitest';
import { interactionEra, funnelByEra, smallNumbersGuard, velocityByEra, impactSentence } from './dashboard-era';
import type { Db, Entity, Interaction, Org } from './types';

const JOINED = '2026-07-21T00:00:00Z';

describe('interactionEra', () => {
  it('an imported row is always "before", regardless of its occurred_at date', () => {
    expect(interactionEra({ source: 'import', occurred_at: '2026-08-22T00:00:00Z' }, JOINED)).toBe('before');
  });

  it('a manually-logged row that pre-dates joining is "before"', () => {
    expect(interactionEra({ source: 'manual', occurred_at: '2018-01-01T00:00:00Z' }, JOINED)).toBe('before');
  });

  it('a manually-logged row after joining is "platform"', () => {
    expect(interactionEra({ source: 'manual', occurred_at: '2026-08-01T00:00:00Z' }, JOINED)).toBe('platform');
  });

  it('with no joinedAt, everything is "platform" — nothing to split against', () => {
    expect(interactionEra({ source: 'manual', occurred_at: '2018-01-01T00:00:00Z' }, undefined)).toBe('platform');
  });
});

function org(over: Partial<Org> = {}): Org {
  return { id: 'org-1', name: 'ablute_', plan: 'garage', daily_cap: 5, weekly_cap: 20, created_at: JOINED, ...over };
}

function entity(id: string, status: Entity['status'] = 'contacted', source: Entity['source'] = 'manual'): Entity {
  return {
    id, name: id, status, source,
    hard_filter_status: 'none', hook_status: 'missing',
  } as unknown as Entity;
}

function interaction(over: Partial<Interaction> & Pick<Interaction, 'id' | 'entity_id' | 'occurred_at'>): Interaction {
  return {
    direction: 'out', channel: 'email', content: '', source: 'manual',
    ...over,
  } as Interaction;
}

function db(entities: Entity[], interactions: Interaction[]): Db {
  return {
    catalog: [], packs: [], unlocks: [], submissions: [], org: org(), entities, people: [],
    personAffiliations: [], interactions, tasks: [], relationshipState: [], overrides: [], folders: [],
    documents: [], grants: [], views: [], templates: [], automations: [], runs: [], aiReviews: [],
    companyFacts: [], companyPeople: [], tractionMetrics: [], ndas: [], documentVersions: [],
    reawakeningProposals: [], roadmapMilestones: [], fundingRounds: [], roadmapCategories: [],
    roadmapEvents: [], rejectionCodes: [], interactionEdits: [], orgAxisClassifications: [],
  } as Db;
}

describe('funnelByEra — the documented ambiguous case', () => {
  it('an entity contacted during import AND replied-to on-platform counts as contacted in Before AND replied in With Sherlock', () => {
    const e = entity('e1');
    const contactedImport = interaction({ id: 'i1', entity_id: 'e1', occurred_at: '2018-05-01T00:00:00Z', source: 'import', direction: 'out' });
    const repliedPlatform = interaction({ id: 'i2', entity_id: 'e1', occurred_at: '2026-08-01T00:00:00Z', source: 'manual', direction: 'in' });
    const state = db([e], [contactedImport, repliedPlatform]);

    const before = funnelByEra(state, 'before', JOINED);
    const platform = funnelByEra(state, 'platform', JOINED);

    expect(before.contacted).toBe(1);
    expect(before.replied).toBe(0);
    expect(platform.contacted).toBe(0);
    expect(platform.replied).toBe(1);
  });

  it('"all" reduces to the existing entity-status-based counts, unchanged', () => {
    const e1 = entity('e1', 'diligence');
    const e2 = entity('e2', 'invested');
    const state = db([e1, e2], []);
    expect(funnelByEra(state, 'all', JOINED)).toMatchObject({ diligence: 1, committed: 1 });
  });

  it('diligence timing is decided by the stage_change interaction, not just current status', () => {
    const e = entity('e1', 'diligence');
    const toDiligenceBeforeJoin = interaction({
      id: 'sc1', entity_id: 'e1', occurred_at: '2018-01-01T00:00:00Z', source: 'import',
      channel: 'stage_change', content: 'Stage changed to Diligence.',
    });
    const state = db([e], [toDiligenceBeforeJoin]);
    expect(funnelByEra(state, 'before', JOINED).diligence).toBe(1);
    expect(funnelByEra(state, 'platform', JOINED).diligence).toBe(0);
  });
});

describe('velocityByEra', () => {
  it('normalises each era by its OWN span, not a shared window', () => {
    const e = entity('e1');
    const interactions = [
      interaction({ id: 'i1', entity_id: 'e1', occurred_at: '2024-01-01T00:00:00Z', source: 'import', direction: 'out' }),
      interaction({ id: 'i2', entity_id: 'e1', occurred_at: '2026-01-01T00:00:00Z', source: 'import', direction: 'out' }),
      interaction({ id: 'i3', entity_id: 'e1', occurred_at: '2026-08-01T00:00:00Z', source: 'manual', direction: 'out' }),
    ];
    const state = db([e], interactions);
    const now = new Date('2026-08-31T00:00:00Z');
    const before = velocityByEra(state, 'before', JOINED, now);
    const platform = velocityByEra(state, 'platform', JOINED, now);
    // before: 2 contacts spanning ~2.5 years to the join date — a low rate.
    expect(before.contacts).toBe(2);
    expect(before.contactsPerMonth).toBeLessThan(1);
    // platform: 1 contact in ~a month since joining — a much higher rate.
    expect(platform.contacts).toBe(1);
    expect(platform.contactsPerMonth).toBeGreaterThan(before.contactsPerMonth);
  });
});

describe('impactSentence', () => {
  it('uses real numbers and percentages when volume is sufficient', () => {
    const s = impactSentence({ contacted: 40, replied: 10, meeting: 5, diligence: 2, committed: 1 },
      { contacted: 20, replied: 8, meeting: 4, diligence: 1, committed: 0 }, false);
    expect(s).toContain('40 investors');
    expect(s).toContain('25%');
    expect(s).toContain('20');
    expect(s).toContain('40%');
  });

  it('falls back to counts-only phrasing under the small-numbers guard, never a percentage', () => {
    const s = impactSentence({ contacted: 3, replied: 1, meeting: 0, diligence: 0, committed: 0 },
      { contacted: 2, replied: 1, meeting: 0, diligence: 0, committed: 0 }, true);
    expect(s).not.toContain('%');
    expect(s).toContain('Early days');
  });
});

describe('smallNumbersGuard', () => {
  it('guards a platform younger than 30 days regardless of counts', () => {
    expect(smallNumbersGuard(10, 50, 50)).toBe(true);
  });

  it('guards when any compared stage has fewer than 5 entities', () => {
    expect(smallNumbersGuard(90, 3, 20)).toBe(true);
  });

  it('lets a mature platform with enough volume through', () => {
    expect(smallNumbersGuard(90, 12, 20)).toBe(false);
  });
});
