import { describe, expect, it } from 'vitest';
import {
  catalogFieldIsBlank, consensusVisibility, isCommunityEligibleField,
  normalizedValuesMatch, orderedArbitrationPair,
} from './community-consensus';

describe('isCommunityEligibleField', () => {
  it('accepts thesis-like fields', () => {
    for (const f of ['website', 'thesis', 'sectors', 'stage_min', 'check_min_eur', 'key_people', 'aum']) {
      expect(isCommunityEligibleField(f)).toBe(true);
    }
  });

  it('excludes every contact-reachable field — the root privacy rule, inverse direction', () => {
    for (const f of ['email', 'phone', 'general_partner_emails', 'address', 'postal_code']) {
      expect(isCommunityEligibleField(f)).toBe(false);
    }
  });

  it('excludes name — never community-voted, same reasoning as entity-enrichment.ts', () => {
    expect(isCommunityEligibleField('name')).toBe(false);
  });

  it('rejects an unknown field outright', () => {
    expect(isCommunityEligibleField('some_made_up_field')).toBe(false);
  });
});

describe('catalogFieldIsBlank', () => {
  it('is blank for null/undefined/empty string/empty array', () => {
    expect(catalogFieldIsBlank(null)).toBe(true);
    expect(catalogFieldIsBlank(undefined)).toBe(true);
    expect(catalogFieldIsBlank('')).toBe(true);
    expect(catalogFieldIsBlank('   ')).toBe(true);
    expect(catalogFieldIsBlank([])).toBe(true);
  });

  it('is not blank for a real value', () => {
    expect(catalogFieldIsBlank('Seed-stage generalist fund')).toBe(false);
    expect(catalogFieldIsBlank(['healthtech'])).toBe(false);
    expect(catalogFieldIsBlank(0)).toBe(false); // a real check_min_eur of 0 is a value, not "unset"
  });
});

describe('normalizedValuesMatch', () => {
  it('matches identical strings', () => {
    expect(normalizedValuesMatch('Seed', 'Seed')).toBe(true);
  });

  it('is case/whitespace-insensitive', () => {
    expect(normalizedValuesMatch('  Managing Partner  ', 'managing   partner')).toBe(true);
  });

  it('does not match genuinely different text (that is the AI arbiter\'s job, not this)', () => {
    expect(normalizedValuesMatch('Managing Partner: J. Smith', 'John Smith (Managing Partner)')).toBe(false);
  });

  it('compares array values as order-independent, case-insensitive sets', () => {
    expect(normalizedValuesMatch(['HealthTech', 'B2B'], ['b2b', 'healthtech'])).toBe(true);
    expect(normalizedValuesMatch(['healthtech'], ['fintech'])).toBe(false);
  });
});

describe('orderedArbitrationPair', () => {
  it('returns the same ordered pair regardless of call order (cache hits both directions)', () => {
    expect(orderedArbitrationPair('a', 'b')).toEqual(['a', 'b']);
    expect(orderedArbitrationPair('b', 'a')).toEqual(['a', 'b']);
  });
});

describe('consensusVisibility', () => {
  it('is pending with only 1 source, regardless of score', () => {
    expect(consensusVisibility(0, 1)).toBe('pending');
    expect(consensusVisibility(5, 1)).toBe('pending');
  });

  it('is pending with 0 sources', () => {
    expect(consensusVisibility(0, 0)).toBe('pending');
  });

  it('is community right at the 2-source baseline score', () => {
    expect(consensusVisibility(2, 2)).toBe('community');
  });

  it('is verified at score 8 and above', () => {
    expect(consensusVisibility(8, 2)).toBe('verified');
    expect(consensusVisibility(20, 3)).toBe('verified');
  });

  it('is hidden at score 0 or below, even with many sources', () => {
    expect(consensusVisibility(0, 2)).toBe('hidden');
    expect(consensusVisibility(-3, 4)).toBe('hidden');
  });

  it('is community strictly between 0 (exclusive) and 8 (exclusive)', () => {
    expect(consensusVisibility(1, 2)).toBe('community');
    expect(consensusVisibility(7, 2)).toBe('community');
  });
});
