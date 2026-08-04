import { describe, expect, it } from 'vitest';
import { computeProfilePrefill } from './matchdeal-profile-prefill';

describe('computeProfilePrefill', () => {
  it('fills description from org.description when the profile field is empty', () => {
    const result = computeProfilePrefill(
      { description: null, website: null, country: null },
      { description: 'Real one-liner', one_liner: null, website: null, country: null },
    );
    expect(result.description).toBe('Real one-liner');
  });

  it("falls back to org.one_liner when org.description is ALSO empty (ablute_'s exact case)", () => {
    const result = computeProfilePrefill(
      { description: null, website: null, country: null },
      { description: null, one_liner: 'What ablute_ actually does', website: null, country: null },
    );
    expect(result.description).toBe('What ablute_ actually does');
  });

  it('never overwrites a description the founder already set on the profile itself', () => {
    const result = computeProfilePrefill(
      { description: 'Founder wrote this on MatchDeal directly', website: null, country: null },
      { description: 'Org description', one_liner: 'Org one-liner', website: null, country: null },
    );
    expect(result.description).toBe('Founder wrote this on MatchDeal directly');
  });

  it('prefills website and country independently from description', () => {
    const result = computeProfilePrefill(
      { description: null, website: null, country: null },
      { description: null, one_liner: null, website: 'https://acme.co', country: 'Portugal' },
    );
    expect(result.website).toBe('https://acme.co');
    expect(result.country).toBe('Portugal');
  });

  it('leaves every field null when neither the profile nor the org has a value', () => {
    const result = computeProfilePrefill(
      { description: null, website: null, country: null },
      { description: null, one_liner: null, website: null, country: null },
    );
    expect(result).toEqual({ description: null, website: null, country: null });
  });
});
