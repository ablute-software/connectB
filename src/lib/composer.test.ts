import { describe, expect, it } from 'vitest';
import {
  buildComposerContext, enforceGroundedRationale, groundingPromptLines, isUngroundedForRationale,
  UNGROUNDED_CONFIDENCE_CAP, UNGROUNDED_RATIONALE_FALLBACK,
} from './composer';
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
    entities, people, personAffiliations: [], interactions,
    tasks: [], relationshipState: [], overrides: [], folders: [], documents: [],
    grants: [], views: [], templates: [], automations: [], runs: [], aiReviews: [], companyFacts: [], ndas: [], documentVersions: [], reawakeningProposals: [],
    companyPeople: [], tractionMetrics: [], roadmapMilestones: [], fundingRounds: [], roadmapCategories: [], roadmapEvents: [], rejectionCodes: [], interactionEdits: [], orgAxisClassifications: [],
    interactionDocuments: [], sherlockNextSnoozes: [], entityReopenSnapshots: [], capTableEntries: [],
    startupInvestorDecisions: [],
    dealTerms: [],
  };
}

// Prompt 893 §F — the real production shape of catalog_entities
// a05ad199… / entities be4ea690… ("Insight Venture", confirmed by direct
// read-only query against wkjcaoqdvhykrfacsylr on 29/09/2026): thesis
// null, sectors [], website null, check_min/max null, submission_channel
// null, zero `people` rows. Reproduced here as a fixture since the exact
// production entity can't be pulled into a unit test.
function insightVentureLikeEntity(): Entity {
  return makeEntity({
    id: 'ent-insight', name: 'Insight Venture', thesis: undefined, sectors: [],
    website: undefined, our_angle: undefined, the_ask: undefined,
    check_min_eur: undefined, check_max_eur: undefined, submission_channel: undefined,
  });
}

describe('isUngroundedForRationale / groundingPromptLines / enforceGroundedRationale — Prompt 893 §F', () => {
  it('an entity with a thesis is grounded — no fallback forced', () => {
    expect(isUngroundedForRationale({ investor: { entityName: 'X', entityType: 'vc', thesis: 'We back deep tech.', sectors: [] } })).toBe(false);
  });

  it('an entity with sectors but no thesis is still grounded (sectors alone are real information)', () => {
    expect(isUngroundedForRationale({ investor: { entityName: 'X', entityType: 'vc', sectors: ['fintech'] } })).toBe(false);
  });

  it('no thesis and no sectors → ungrounded', () => {
    expect(isUngroundedForRationale({ investor: { entityName: 'Insight Venture', entityType: 'vc', sectors: [] } })).toBe(true);
  });

  it('groundingPromptLines only appends the forced-fallback instruction when ungrounded', () => {
    const grounded = groundingPromptLines({ investor: { entityName: 'X', entityType: 'vc', thesis: 'x', sectors: [] } });
    expect(grounded.join('\n')).not.toContain(UNGROUNDED_RATIONALE_FALLBACK);

    const ungrounded = groundingPromptLines({ investor: { entityName: 'Insight Venture', entityType: 'vc', sectors: [] } });
    expect(ungrounded.join('\n')).toContain(UNGROUNDED_RATIONALE_FALLBACK);
    expect(ungrounded.join('\n')).toContain(`${UNGROUNDED_CONFIDENCE_CAP}`);
  });

  it('groundingPromptLines always states the citation-in-parentheses rule, grounded or not', () => {
    const lines = groundingPromptLines({ investor: { entityName: 'X', entityType: 'vc', thesis: 'x', sectors: [] } }).join('\n');
    expect(lines).toContain('(thesis)');
    expect(lines).toContain('(sectors)');
    expect(lines).toContain('(how we pitch)');
    expect(lines).toContain('(last reply)');
  });

  it('enforceGroundedRationale passes a grounded draft through untouched', () => {
    const context = { investor: { entityName: 'X', entityType: 'vc', thesis: 'We back deep tech.', sectors: [] } };
    const draft = { rationale: 'Uses their public thesis on deep tech (thesis).', confidence: 0.8 };
    expect(enforceGroundedRationale(context, draft)).toEqual(draft);
  });

  it('enforceGroundedRationale overrides an ungrounded draft regardless of what the model said — the deterministic backstop', () => {
    const context = { investor: { entityName: 'Insight Venture', entityType: 'vc', sectors: [] } };
    // Simulates exactly the failure mode Nuno reported: the model invented
    // a "focus" and a confident-sounding number despite empty thesis/sectors.
    const hallucinated = { rationale: 'Given their focus on health-tech and a medium fit with ablute_...', confidence: 0.9 };
    const result = enforceGroundedRationale(context, hallucinated);
    expect(result.rationale).toBe(UNGROUNDED_RATIONALE_FALLBACK);
    expect(result.confidence).toBeLessThanOrEqual(UNGROUNDED_CONFIDENCE_CAP);
  });

  it('enforceGroundedRationale never RAISES confidence — a model that was already honest and cautious (0.2) stays at 0.2, not bumped to 0.4', () => {
    const context = { investor: { entityName: 'Insight Venture', entityType: 'vc', sectors: [] } };
    const cautious = { rationale: UNGROUNDED_RATIONALE_FALLBACK, confidence: 0.2 };
    expect(enforceGroundedRationale(context, cautious).confidence).toBe(0.2);
  });

  it('§F audit fixture — buildComposerContext for an empty, never-contacted, Insight-Venture-shaped entity is ungrounded and carries no invented person', () => {
    const entity = insightVentureLikeEntity();
    const db = makeDb([entity]);
    const context = buildComposerContext(db, 'ent-insight', '', 'email');
    expect(isUngroundedForRationale(context)).toBe(true);
    expect(context.investor.thesis).toBeUndefined();
    expect(context.investor.sectors).toEqual([]);
    expect(context.person.fullName).toBe(''); // no people on file — never a fabricated name
  });
});
