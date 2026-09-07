import { describe, expect, it } from 'vitest';
import { canSuggest, qualifyingBadge, SUGGESTION_BADGES, SUGGESTIONS_PROGRAMME_OPEN } from './suggestions-gate';

describe('suggestions gate (Prompt 605 §B)', () => {
  it('opens for a tech master', () => {
    expect(canSuggest({ activeBadges: ['tech_master'] })).toBe(true);
  });

  it('opens for a pioneer', () => {
    expect(canSuggest({ activeBadges: ['pioneer'] })).toBe(true);
  });

  it('stays shut for an org with no badge — the whole point of the gate', () => {
    expect(canSuggest({ activeBadges: [] })).toBe(false);
  });

  it('stays shut for a Phase-2 badge: those are computed activity marks, not the cohort', () => {
    expect(canSuggest({ activeBadges: ['sedulous', 'dyed_in_the_wool', 'toughness'] })).toBe(false);
  });

  it('closes for everyone once the programme ends, badge or not', () => {
    expect(canSuggest({ activeBadges: ['tech_master'], programmeOpen: false })).toBe(false);
    expect(canSuggest({ activeBadges: ['pioneer'], programmeOpen: false })).toBe(false);
  });

  it('is open today — beta has not shipped', () => {
    expect(SUGGESTIONS_PROGRAMME_OPEN).toBe(true);
  });

  it('names the qualifying badge, tech master first when an org holds both', () => {
    expect(qualifyingBadge(['pioneer', 'tech_master'])).toBe('tech_master');
    expect(qualifyingBadge(['pioneer'])).toBe('pioneer');
    expect(qualifyingBadge(['sedulous'])).toBeNull();
    expect(qualifyingBadge([])).toBeNull();
  });

  it('covers exactly the two cohort badges of Prompt 601 Phase 1', () => {
    expect([...SUGGESTION_BADGES]).toEqual(['tech_master', 'pioneer']);
  });
});
