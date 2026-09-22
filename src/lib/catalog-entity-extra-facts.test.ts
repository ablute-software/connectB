import { describe, it, expect } from 'vitest';
import {
  isCatalogEntityExtraFactKey, sanitizeCatalogEntityExtraFact, buildCatalogEntityExtraFactsPatch,
} from './catalog-entity-extra-facts';

describe('isCatalogEntityExtraFactKey', () => {
  it('accepts a registered key', () => {
    expect(isCatalogEntityExtraFactKey('warm_intro_required')).toBe(true);
  });
  it('rejects a name not in the registry', () => {
    expect(isCatalogEntityExtraFactKey('made_up_field')).toBe(false);
  });
});

describe('sanitizeCatalogEntityExtraFact', () => {
  it('accepts a known fact with a real value', () => {
    expect(sanitizeCatalogEntityExtraFact({ value: '48h', status: 'known', source: 'website', checked_at: '2026-09-22', note: null }))
      .toEqual({ value: '48h', status: 'known', source: 'website', checked_at: '2026-09-22', note: null });
  });
  it('accepts NOT_PUBLIC with a null value — never collapses the state to a bare null', () => {
    const fact = sanitizeCatalogEntityExtraFact({ value: null, status: 'not_public', source: null, checked_at: '2026-09-22', note: null });
    expect(fact?.status).toBe('not_public');
    expect(fact?.checked_at).toBe('2026-09-22');
  });
  it('accepts CONFLICT and keeps it a distinct state, not a resolved value', () => {
    const fact = sanitizeCatalogEntityExtraFact({ value: '2M EUR', status: 'conflict', source: 'site vs. nota 11/05', checked_at: null, note: 'site diz 1.5M, nota diz 2M' });
    expect(fact?.status).toBe('conflict');
  });
  it('rejects a missing status', () => {
    expect(sanitizeCatalogEntityExtraFact({ value: 'x' })).toBeNull();
  });
  it('rejects a status outside the four allowed states', () => {
    expect(sanitizeCatalogEntityExtraFact({ value: 'x', status: 'confirmed' })).toBeNull();
  });
  it('rejects a non-primitive value', () => {
    expect(sanitizeCatalogEntityExtraFact({ value: { nested: true }, status: 'known' })).toBeNull();
  });
  it('rejects a non-object input', () => {
    expect(sanitizeCatalogEntityExtraFact('not an object')).toBeNull();
    expect(sanitizeCatalogEntityExtraFact(null)).toBeNull();
  });
  it('blanks out empty-string optional fields to null, same convention as the rest of the codebase', () => {
    const fact = sanitizeCatalogEntityExtraFact({ value: 'x', status: 'known', source: '  ', note: '' });
    expect(fact?.source).toBeNull();
    expect(fact?.note).toBeNull();
  });
});

describe('buildCatalogEntityExtraFactsPatch', () => {
  it('keeps only registered keys with a valid shape', () => {
    const patch = buildCatalogEntityExtraFactsPatch({
      warm_intro_required: { value: true, status: 'known' },
      not_a_real_field: { value: 'x', status: 'known' },
      decision_time: { value: 'invalid, missing status' },
    });
    expect(Object.keys(patch)).toEqual(['warm_intro_required']);
    expect(patch.warm_intro_required?.value).toBe(true);
  });
  it('returns an empty object for no valid entries', () => {
    expect(buildCatalogEntityExtraFactsPatch({})).toEqual({});
  });
});
