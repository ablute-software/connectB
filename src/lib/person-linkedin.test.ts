import { describe, it, expect } from 'vitest';
import { personLinkedInUrl, isTrustworthyOrgVerifiedFlag } from './person-linkedin';

describe('personLinkedInUrl', () => {
  it('prefers the catalog URL even when the org has a non-empty value — the Zanchi case', () => {
    const person = { linkedin_url: 'https://www.linkedin.com/in/martagzanchi', linkedin_verified: true, data_source: 'Fund site + public talks, Jul 2026' };
    const catalogPerson = { linkedin_url: 'https://www.linkedin.com/in/mgzanchi', linkedin_verified: true };
    const result = personLinkedInUrl(person, catalogPerson);
    expect(result).toEqual({ url: 'https://www.linkedin.com/in/mgzanchi', verified: true, source: 'catalog' });
  });

  it('fills the gap when the org field is empty and the catalog has a value — the 313-row case', () => {
    const person = { linkedin_url: undefined, linkedin_verified: false, data_source: 'Promoted from verified key_people research (bulk)' };
    const catalogPerson = { linkedin_url: 'https://www.linkedin.com/in/someone', linkedin_verified: true };
    const result = personLinkedInUrl(person, catalogPerson);
    expect(result).toEqual({ url: 'https://www.linkedin.com/in/someone', verified: true, source: 'catalog' });
  });

  it('falls back to the org value when there is no linked catalog person at all', () => {
    const person = { linkedin_url: 'https://www.linkedin.com/in/self-reported', linkedin_verified: true, data_source: 'founder_invite' };
    const result = personLinkedInUrl(person, undefined);
    expect(result).toEqual({ url: 'https://www.linkedin.com/in/self-reported', verified: true, source: 'org' });
  });

  it('falls back to the org value when the catalog person exists but has no LinkedIn on file', () => {
    const person = { linkedin_url: 'https://www.linkedin.com/in/self-reported', linkedin_verified: true, data_source: 'founder_invite' };
    const catalogPerson = { linkedin_url: null, linkedin_verified: false };
    const result = personLinkedInUrl(person, catalogPerson);
    expect(result).toEqual({ url: 'https://www.linkedin.com/in/self-reported', verified: true, source: 'org' });
  });

  it('the org fallback value is marked unverified when its own verified flag is untrustworthy (Jul 2026 import)', () => {
    const person = { linkedin_url: 'https://www.linkedin.com/in/stale', linkedin_verified: true, data_source: 'Fund site + public talks, Jul 2026' };
    const result = personLinkedInUrl(person, null);
    expect(result).toEqual({ url: 'https://www.linkedin.com/in/stale', verified: false, source: 'org' });
  });

  it('returns none when neither side has a LinkedIn at all', () => {
    const person = { linkedin_url: undefined, linkedin_verified: false, data_source: undefined };
    const result = personLinkedInUrl(person, { linkedin_url: null, linkedin_verified: false });
    expect(result).toEqual({ url: null, verified: false, source: 'none' });
  });
});

describe('isTrustworthyOrgVerifiedFlag', () => {
  it('is false outright when linkedin_verified itself is false', () => {
    expect(isTrustworthyOrgVerifiedFlag({ linkedin_verified: false, data_source: 'founder_invite' })).toBe(false);
  });

  it('is false when data_source is null/undefined — no recorded provenance is no better than a known-bad one', () => {
    expect(isTrustworthyOrgVerifiedFlag({ linkedin_verified: true, data_source: undefined })).toBe(false);
  });

  it('is false for the exact July 2026 import data_source string', () => {
    expect(isTrustworthyOrgVerifiedFlag({ linkedin_verified: true, data_source: 'Fund site + public talks, Jul 2026' })).toBe(false);
  });

  it('is true for a verified flag with a real, non-import data_source', () => {
    expect(isTrustworthyOrgVerifiedFlag({ linkedin_verified: true, data_source: 'founder_invite' })).toBe(true);
  });
});
