import { describe, expect, it } from 'vitest';
import {
  catalogDriftSince, claimedProfileSince, declaredInvestmentToReopenRecord, newInvestmentsSince, reopenSignal, suggestedReapproach,
  type ReopenSignalsDb,
} from './reopen-signals';
import type { Entity, EntityReopenSnapshot, Interaction, Person, ReawakeningProposal } from './types';

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

function makePerson(overrides: Partial<Person> & { id: string; entity_id: string }): Person {
  return {
    full_name: overrides.id, seniority_rank: 1, linkedin_verified: false, bounce_count: 0,
    linked_companies: [], linked_funds: [], hook_status: 'researched', kill_words: [],
    preferred_language: 'en', privacy_notice_sent: false, do_not_contact: false,
    ...overrides,
  };
}

function makeDb(overrides: Partial<ReopenSignalsDb> = {}): ReopenSignalsDb {
  return {
    catalog: [], packs: [], unlocks: [], submissions: [],
    org: { id: 'org-1', name: 'ablute_', plan: 'idea', daily_cap: 5, weekly_cap: 20 },
    entities: [], people: [], personAffiliations: [], interactions: [],
    tasks: [], relationshipState: [], overrides: [], folders: [], documents: [],
    grants: [], views: [], templates: [], automations: [], runs: [], aiReviews: [], companyFacts: [], ndas: [], documentVersions: [],
    reawakeningProposals: [],
    companyPeople: [], tractionMetrics: [], roadmapMilestones: [], fundingRounds: [], roadmapCategories: [], roadmapEvents: [],
    rejectionCodes: [], interactionEdits: [], orgAxisClassifications: [],
    interactionDocuments: [], sherlockNextSnoozes: [], entityReopenSnapshots: [], capTableEntries: [],
    catalogDeliveries: [], investorInvestments: [], approvedClaims: [], catalogCurrent: [],
    ...overrides,
  };
}

const PASS_DATE = '2026-01-01T00:00:00.000Z';

function passedEntity(overrides: Partial<Entity> = {}): Entity {
  return makeEntity({ id: 'ent-1', status: 'passed', ...overrides });
}

// effectiveMode() (relationship.ts) resolves the entity via db.entities.find,
// not the `entity` argument reopenSignal/suggestedReapproach were also
// given — so every fixture below needs the SAME entity in both places.
// Adds the default passedEntity() only when the caller hasn't already
// supplied their own (e.g. to test a different status) via makeDb({entities}).
function withPassInteraction(db: ReopenSignalsDb): ReopenSignalsDb {
  return {
    ...db,
    entities: db.entities.length ? db.entities : [passedEntity()],
    interactions: [...db.interactions, makeInteraction({
      id: 'i-pass', entity_id: 'ent-1', direction: 'in', occurred_at: PASS_DATE, classification: 'pass',
    })],
  };
}

describe('newInvestmentsSince — Prompt 416 §B.1', () => {
  it('returns investments after sinceDate for the entity\'s catalog counterpart', () => {
    const db = makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      investorInvestments: [
        { investorCatalogId: 'cat-1', companyName: 'Acme Health', sectors: ['healthtech'], investedAt: '2026-02-01' },
      ],
    });
    const result = newInvestmentsSince(passedEntity(), db, PASS_DATE);
    expect(result).toHaveLength(1);
    expect(result[0].companyName).toBe('Acme Health');
  });

  it('excludes investments before sinceDate', () => {
    const db = makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      investorInvestments: [
        { investorCatalogId: 'cat-1', companyName: 'Old Co', sectors: [], investedAt: '2025-01-01' },
      ],
    });
    expect(newInvestmentsSince(passedEntity(), db, PASS_DATE)).toEqual([]);
  });

  it('returns nothing when the entity has no catalog counterpart', () => {
    const db = makeDb({
      investorInvestments: [{ investorCatalogId: 'cat-1', companyName: 'Acme Health', sectors: [], investedAt: '2026-02-01' }],
    });
    expect(newInvestmentsSince(passedEntity(), db, PASS_DATE)).toEqual([]);
  });
});

describe('claimedProfileSince — Prompt 416 §B.2', () => {
  it('returns the approval date when claimed after sinceDate', () => {
    const db = makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      approvedClaims: [{ catalogId: 'cat-1', approvedAt: '2026-03-01' }],
    });
    expect(claimedProfileSince(passedEntity(), db, PASS_DATE)).toBe('2026-03-01');
  });

  it('returns null when the claim predates sinceDate', () => {
    const db = makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      approvedClaims: [{ catalogId: 'cat-1', approvedAt: '2025-01-01' }],
    });
    expect(claimedProfileSince(passedEntity(), db, PASS_DATE)).toBeNull();
  });
});

describe('catalogDriftSince — Prompt 416 §B.3', () => {
  const snapshot: EntityReopenSnapshot = {
    id: 'snap-1', entity_id: 'ent-1', captured_at: PASS_DATE, reason: 'passed',
    sectors_at_time: ['fintech'], stage_min_at_time: 'seed', stage_max_at_time: 'seed',
    investor_claimed_at_time: false, investment_count_at_time: 0,
  };

  it('never invents drift when there is no snapshot', () => {
    const db = makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      catalogCurrent: [{ catalogId: 'cat-1', sectors: ['healthtech'], stageMin: 'seed', stageMax: 'seed' }],
    });
    expect(catalogDriftSince(passedEntity(), db, undefined)).toEqual([]);
  });

  it('reports only the fields that actually changed', () => {
    const db = makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      catalogCurrent: [{ catalogId: 'cat-1', sectors: ['healthtech'], stageMin: 'seed', stageMax: 'seed' }],
    });
    const drift = catalogDriftSince(passedEntity(), db, snapshot);
    expect(drift).toHaveLength(1);
    expect(drift[0].field).toBe('sectors');
  });

  it('reports nothing when the catalog counterpart is unchanged', () => {
    const db = makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      catalogCurrent: [{ catalogId: 'cat-1', sectors: ['fintech'], stageMin: 'seed', stageMax: 'seed' }],
    });
    expect(catalogDriftSince(passedEntity(), db, snapshot)).toEqual([]);
  });
});

describe('declaredInvestmentToReopenRecord — Prompt 421 §C.3', () => {
  it('maps a declared investment into the same shape investor_investments produces', () => {
    const result = declaredInvestmentToReopenRecord({
      catalog_entity_id: 'cat-1', company_name: 'Acme Health', sector: 'healthtech', invested_at: '2026-02-01',
    });
    expect(result).toEqual({ investorCatalogId: 'cat-1', companyName: 'Acme Health', sectors: ['healthtech'], investedAt: '2026-02-01' });
  });

  it('returns an empty sectors array when no sector was declared', () => {
    const result = declaredInvestmentToReopenRecord({
      catalog_entity_id: 'cat-1', company_name: 'Acme Health', sector: null, invested_at: '2026-02-01',
    });
    expect(result?.sectors).toEqual([]);
  });

  it('returns null when no date was declared — nothing to compare against sinceDate', () => {
    const result = declaredInvestmentToReopenRecord({
      catalog_entity_id: 'cat-1', company_name: 'Acme Health', sector: 'healthtech', invested_at: null,
    });
    expect(result).toBeNull();
  });

  it('feeds newInvestmentsSince identically to a market-researched row', () => {
    const declared = declaredInvestmentToReopenRecord({
      catalog_entity_id: 'cat-1', company_name: 'Acme Health', sector: 'healthtech', invested_at: '2026-02-01',
    });
    const db = makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      investorInvestments: declared ? [declared] : [],
    });
    const result = newInvestmentsSince(passedEntity(), db, PASS_DATE);
    expect(result).toHaveLength(1);
    expect(result[0].companyName).toBe('Acme Health');
  });
});

describe('reopenSignal — Prompt 416 §B.4', () => {
  it('is null for an active (not parked/closed) entity', () => {
    const entity = makeEntity({ id: 'ent-1', status: 'contacted' });
    // No pass-classified interaction here on purpose — effectiveMode()
    // treats ANY pass-classified inbound as 'closed' regardless of
    // entities.status (that's its own documented override), so this case
    // has to stay free of one to actually exercise the "active" branch.
    const db = makeDb({ entities: [entity] });
    expect(reopenSignal(entity, db)).toBeNull();
  });

  it('is null for an invested entity — already a closed win, nothing to reopen', () => {
    const entity = makeEntity({ id: 'ent-1', status: 'invested' });
    const db = withPassInteraction(makeDb({ entities: [entity] }));
    expect(reopenSignal(entity, db)).toBeNull();
  });

  it('fires tier "investment" when the top signal is a new investment', () => {
    const db = withPassInteraction(makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      investorInvestments: [{ investorCatalogId: 'cat-1', companyName: 'Acme Health', sectors: ['healthtech'], investedAt: '2026-02-01' }],
      approvedClaims: [{ catalogId: 'cat-1', approvedAt: '2026-01-15' }], // lower priority — must not win
    }));
    const signal = reopenSignal(passedEntity(), db, new Date('2026-02-15'));
    expect(signal?.tier).toBe('investment');
    expect(signal?.detail).toContain('Acme Health');
  });

  it('does not fire "investment" for an investment before the pass date', () => {
    const db = withPassInteraction(makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      investorInvestments: [{ investorCatalogId: 'cat-1', companyName: 'Old Co', sectors: [], investedAt: '2025-06-01' }],
    }));
    const signal = reopenSignal(passedEntity(), db, new Date('2026-01-10'));
    expect(signal).toBeNull(); // <90 days since pass, no other signal
  });

  it('fires tier "claim" when there is no investment but a new claim', () => {
    const db = withPassInteraction(makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      approvedClaims: [{ catalogId: 'cat-1', approvedAt: '2026-01-20' }],
    }));
    const signal = reopenSignal(passedEntity(), db, new Date('2026-02-01'));
    expect(signal?.tier).toBe('claim');
  });

  it('does not fire "claim" for a claim approved before the pass date', () => {
    const db = withPassInteraction(makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      approvedClaims: [{ catalogId: 'cat-1', approvedAt: '2025-06-01' }],
    }));
    expect(reopenSignal(passedEntity(), db, new Date('2026-01-10'))).toBeNull();
  });

  it('fires tier "drift" when there is no investment/claim but the catalog profile changed', () => {
    const snapshot: EntityReopenSnapshot = {
      id: 'snap-1', entity_id: 'ent-1', captured_at: PASS_DATE, reason: 'passed',
      sectors_at_time: ['fintech'], investor_claimed_at_time: false, investment_count_at_time: 0,
    };
    const db = withPassInteraction(makeDb({
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      catalogCurrent: [{ catalogId: 'cat-1', sectors: ['healthtech'], stageMin: null, stageMax: null }],
      entityReopenSnapshots: [snapshot],
    }));
    const signal = reopenSignal(passedEntity(), db, new Date('2026-02-01'));
    expect(signal?.tier).toBe('drift');
  });

  it('gives the low-confidence nudge only after 90 days, and only when no better tier fires', () => {
    const db = withPassInteraction(makeDb());
    expect(reopenSignal(passedEntity(), db, new Date('2026-03-01'))).toBeNull(); // 59 days — too early
    const nudged = reopenSignal(passedEntity(), db, new Date('2026-04-05')); // ~94 days
    expect(nudged?.tier).toBe('none');
    expect(nudged?.lowConfidenceNudge).toBe(true);
  });

  it('never nudges before 90 days even with zero other signal', () => {
    const db = withPassInteraction(makeDb());
    const justUnder = reopenSignal(passedEntity(), db, new Date('2026-03-31')); // 89 days
    expect(justUnder).toBeNull();
  });

  it('an existing pending reawakeningProposal always wins, even over an investment signal', () => {
    const proposal: ReawakeningProposal = {
      id: 'rp-1', entity_id: 'ent-1', reopens: true, rejection_code_id: 'code-1',
      status: 'pending', created_at: '2026-01-05',
    };
    const db = withPassInteraction(makeDb({
      reawakeningProposals: [proposal],
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      investorInvestments: [{ investorCatalogId: 'cat-1', companyName: 'Acme Health', sectors: [], investedAt: '2026-02-01' }],
    }));
    expect(reopenSignal(passedEntity(), db, new Date('2026-02-15'))).toBeNull();
  });

  it('a resolved (non-pending) reawakeningProposal does not block this signal', () => {
    const proposal: ReawakeningProposal = {
      id: 'rp-1', entity_id: 'ent-1', reopens: true, rejection_code_id: 'code-1',
      status: 'approved', created_at: '2026-01-05',
    };
    const db = withPassInteraction(makeDb({
      reawakeningProposals: [proposal],
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      investorInvestments: [{ investorCatalogId: 'cat-1', companyName: 'Acme Health', sectors: [], investedAt: '2026-02-01' }],
    }));
    expect(reopenSignal(passedEntity(), db, new Date('2026-02-15'))?.tier).toBe('investment');
  });

  it('uses dormant_since for a parked entity with no formal pass classification', () => {
    const entity = makeEntity({ id: 'ent-1', status: 'dormant', dormant_since: PASS_DATE });
    const db = makeDb({
      entities: [entity],
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      investorInvestments: [{ investorCatalogId: 'cat-1', companyName: 'Acme Health', sectors: [], investedAt: '2026-02-01' }],
    });
    const signal = reopenSignal(entity, db, new Date('2026-02-15'));
    expect(signal?.tier).toBe('investment');
    expect(signal?.since).toBe(PASS_DATE);
  });
});

describe('suggestedReapproach — Prompt 416 §B.5', () => {
  it('names the next contact and a green pre-flight when nothing blocks it', () => {
    const person = makePerson({ id: 'p-1', entity_id: 'ent-1', full_name: 'Jane Doe', hook_status: 'researched' });
    const db = withPassInteraction(makeDb({ people: [person] }));
    const result = suggestedReapproach(passedEntity(), db, new Date('2026-01-10'));
    expect(result.personName).toBe('Jane Doe');
  });

  it('suggests the investment as the opening hook when the signal tier is "investment"', () => {
    const person = makePerson({ id: 'p-1', entity_id: 'ent-1', full_name: 'Jane Doe' });
    const db = withPassInteraction(makeDb({
      people: [person],
      catalogDeliveries: [{ entity_id: 'ent-1', catalog_id: 'cat-1' }],
      investorInvestments: [{ investorCatalogId: 'cat-1', companyName: 'Acme Health', sectors: ['healthtech'], investedAt: '2026-02-01' }],
    }));
    const result = suggestedReapproach(passedEntity(), db, new Date('2026-02-15'));
    expect(result.openingHook).toContain('Acme Health');
  });

  it('leaves openingHook unset when there is no investment signal', () => {
    const person = makePerson({ id: 'p-1', entity_id: 'ent-1', full_name: 'Jane Doe' });
    const db = withPassInteraction(makeDb({ people: [person] }));
    const result = suggestedReapproach(passedEntity(), db, new Date('2026-01-10'));
    expect(result.openingHook).toBeUndefined();
  });
});
