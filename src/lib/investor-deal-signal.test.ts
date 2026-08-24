import { describe, it, expect } from 'vitest';
import { isValidConsidering, sanitizeInstruments, CONSIDERING_VALUES } from './investor-deal-signal';

describe('isValidConsidering', () => {
  it('accepts the three known values', () => {
    expect(isValidConsidering('lead')).toBe(true);
    expect(isValidConsidering('co_lead')).toBe(true);
    expect(isValidConsidering('both')).toBe(true);
  });

  it('rejects anything outside the fixed taxonomy', () => {
    expect(isValidConsidering('leading')).toBe(false);
    expect(isValidConsidering('')).toBe(false);
    expect(isValidConsidering(null)).toBe(false);
    expect(isValidConsidering(undefined)).toBe(false);
    expect(isValidConsidering(42)).toBe(false);
  });

  it('CONSIDERING_VALUES matches the matchdeal_profiles.lead_or_colead check constraint', () => {
    expect(CONSIDERING_VALUES).toEqual(['lead', 'co_lead', 'both']);
  });
});

describe('sanitizeInstruments', () => {
  it('passes through a clean string array', () => {
    expect(sanitizeInstruments(['equity', 'safe'])).toEqual(['equity', 'safe']);
  });

  it('drops non-string and empty-string entries', () => {
    expect(sanitizeInstruments(['equity', '', 42, null, '  '])).toEqual(['equity']);
  });

  it('returns an empty array for anything that is not an array', () => {
    expect(sanitizeInstruments(undefined)).toEqual([]);
    expect(sanitizeInstruments(null)).toEqual([]);
    expect(sanitizeInstruments('equity')).toEqual([]);
  });
});
