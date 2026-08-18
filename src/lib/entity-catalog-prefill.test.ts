import { describe, expect, it } from 'vitest';
import { computeEntitySummaryPrefill, matchEntityToCatalog } from './entity-catalog-prefill';
import type { CatalogEntity, Entity } from './types';

function entity(over: Partial<Entity> = {}): Entity {
  return {
    id: 'e1', name: 'Invest Green', type: 'vc', invests_in_geographies: [], website_verified: false,
    email_domain_verified: false, sectors: [], ...over,
  } as Entity;
}

function catalogEntity(over: Partial<CatalogEntity> = {}): CatalogEntity {
  return {
    id: 'cat-1', name: 'Invest Green Capital', type: 'vc', sectors: ['climate', 'sustainability'],
    verification_status: 'verified', source: 'team', website: 'https://investgreen.vc',
    hq_city: 'Lisbon', hq_country: 'PT', stage_min: 'seed', stage_max: 'series_a',
    check_min_eur: 100_000, check_max_eur: 500_000, thesis: 'We back climate-first founders.',
    ...over,
  } as CatalogEntity;
}

describe('matchEntityToCatalog', () => {
  const catalog = [
    catalogEntity({ id: 'cat-1', name: 'Invest Green Capital', website: 'https://investgreen.vc' }),
    catalogEntity({ id: 'cat-2', name: 'Balderton Capital', website: undefined }),
  ];

  it('matches by website domain first, regardless of protocol/www', () => {
    const e = entity({ name: 'Invest Green (added from platform interest)', website: 'www.investgreen.vc' });
    expect(matchEntityToCatalog(e, catalog)?.id).toBe('cat-1');
  });

  it('matches a subdomain of the catalog entity\'s own domain', () => {
    const e = entity({ name: 'unrelated name', website: 'https://team.investgreen.vc' });
    expect(matchEntityToCatalog(e, catalog)?.id).toBe('cat-1');
  });

  it('falls back to an exact normalized name match when there is no website', () => {
    const e = entity({ name: 'balderton capital', website: undefined });
    expect(matchEntityToCatalog(e, catalog)?.id).toBe('cat-2');
  });

  it('does not guess on an ambiguous normalized name match (two catalog rows collide)', () => {
    const ambiguousCatalog = [
      catalogEntity({ id: 'cat-1', name: 'Acme Ventures', website: undefined }),
      catalogEntity({ id: 'cat-2', name: 'Acme Capital', website: undefined }), // normalizes to the same "acme"
    ];
    const e = entity({ name: 'Acme', website: undefined });
    expect(matchEntityToCatalog(e, ambiguousCatalog)).toBeNull();
  });

  it('returns null when neither website nor name resolves to any catalog row', () => {
    const e = entity({ name: 'Some Random Angel', website: 'https://not-tracked-anywhere.com' });
    expect(matchEntityToCatalog(e, catalog)).toBeNull();
  });

  it('returns null against an empty catalog', () => {
    expect(matchEntityToCatalog(entity(), [])).toBeNull();
  });
});

describe('computeEntitySummaryPrefill', () => {
  const match = catalogEntity();

  it('returns nothing when there is no catalog match', () => {
    expect(computeEntitySummaryPrefill(entity(), null)).toEqual({});
  });

  it('fills every empty field from a fresh, all-empty entity', () => {
    const prefill = computeEntitySummaryPrefill(entity(), match);
    expect(prefill).toEqual({
      website: 'https://investgreen.vc',
      hqCity: 'Lisbon', hqCountry: 'PT',
      sectors: ['climate', 'sustainability'],
      stageMin: 'seed', stageMax: 'series_a',
      checkMinEur: 100_000, checkMaxEur: 500_000,
      thesis: 'We back climate-first founders.',
    });
  });

  it('never overrides a field the founder already set', () => {
    const founderEdited = entity({
      website: 'https://founder-typed-this.com', hq_city: 'Porto', hq_country: 'PT',
      sectors: ['fintech'], stage_min: 'pre_seed', stage_max: 'pre_seed',
      check_min_eur: 10_000, check_max_eur: 50_000, thesis: 'Founder-written thesis.',
    });
    expect(computeEntitySummaryPrefill(founderEdited, match)).toEqual({});
  });

  it('fills only the fields still empty, leaving founder-set fields untouched', () => {
    const partiallyEdited = entity({ sectors: ['fintech'] }); // only sectors touched
    const prefill = computeEntitySummaryPrefill(partiallyEdited, match);
    expect(prefill.sectors).toBeUndefined();
    expect(prefill.website).toBe('https://investgreen.vc');
    expect(prefill.thesis).toBe('We back climate-first founders.');
  });

  it('treats HQ as one unit — a partially-set HQ (country only) counts as not-empty, no prefill', () => {
    const partialHq = entity({ hq_country: 'FR' });
    const prefill = computeEntitySummaryPrefill(partialHq, match);
    expect(prefill.hqCity).toBeUndefined();
    expect(prefill.hqCountry).toBeUndefined();
  });

  it('treats stage range as one unit — a partially-set range counts as not-empty, no prefill', () => {
    const partialStage = entity({ stage_min: 'pre_seed' });
    const prefill = computeEntitySummaryPrefill(partialStage, match);
    expect(prefill.stageMin).toBeUndefined();
    expect(prefill.stageMax).toBeUndefined();
  });

  it('treats check range as one unit — a partially-set range counts as not-empty, no prefill', () => {
    const partialCheck = entity({ check_min_eur: 20_000 });
    const prefill = computeEntitySummaryPrefill(partialCheck, match);
    expect(prefill.checkMinEur).toBeUndefined();
    expect(prefill.checkMaxEur).toBeUndefined();
  });

  it('never pulls geographies — deliberately excluded even though it is empty', () => {
    const prefill = computeEntitySummaryPrefill(entity(), match);
    expect(prefill).not.toHaveProperty('geographies');
  });

  it('skips a field the catalog itself has nothing for', () => {
    const sparse = catalogEntity({ thesis: undefined, website: undefined });
    const prefill = computeEntitySummaryPrefill(entity(), sparse);
    expect(prefill.thesis).toBeUndefined();
    expect(prefill.website).toBeUndefined();
    expect(prefill.hqCity).toBe('Lisbon'); // unaffected fields still fill
  });
});
