import { describe, expect, it } from 'vitest';
import { promotableCatalogTeam, shouldShowFirstContactGuide, type CatalogTeamMember } from './first-contact-selector';
import type { Person } from './types';

function member(overrides: Partial<CatalogTeamMember> & { catalogPersonId: string }): CatalogTeamMember {
  return { fullName: overrides.catalogPersonId, title: null, seniorityRank: 1, ...overrides };
}

function person(overrides: Partial<Person> = {}): Pick<Person, 'catalog_person_id'> {
  return { catalog_person_id: overrides.catalog_person_id };
}

describe('promotableCatalogTeam — Prompt 896 §A', () => {
  it('both groups empty in, empty out — the "Nobody on file" case', () => {
    expect(promotableCatalogTeam([], [])).toEqual([]);
  });

  it('excludes a catalog person already promoted to a real org contact', () => {
    const team = [member({ catalogPersonId: 'cp-1' }), member({ catalogPersonId: 'cp-2' })];
    const own = [person({ catalog_person_id: 'cp-1' })];
    const result = promotableCatalogTeam(team, own);
    expect(result.map((m) => m.catalogPersonId)).toEqual(['cp-2']);
  });

  it('an own contact with no catalog_person_id (hand-added) excludes nothing', () => {
    const team = [member({ catalogPersonId: 'cp-1' })];
    const own = [person({ catalog_person_id: undefined })];
    expect(promotableCatalogTeam(team, own).map((m) => m.catalogPersonId)).toEqual(['cp-1']);
  });

  it('sorts by seniorityRank first, then title', () => {
    const team = [
      member({ catalogPersonId: 'cp-b', seniorityRank: 2, title: 'Analyst' }),
      member({ catalogPersonId: 'cp-a', seniorityRank: 1, title: 'Principal' }),
      member({ catalogPersonId: 'cp-c', seniorityRank: 1, title: 'Managing Partner' }),
    ];
    const result = promotableCatalogTeam(team, []);
    expect(result.map((m) => m.catalogPersonId)).toEqual(['cp-c', 'cp-a', 'cp-b']);
  });
});

describe('shouldShowFirstContactGuide — Prompt 896 §B', () => {
  it('never shows for an inbound log, regardless of anything else', () => {
    expect(shouldShowFirstContactGuide({ direction: 'in', hasSelection: false, neverContactedSelection: false, noOutboundEver: true })).toBe(false);
  });

  it('visible with 0 contacts and 0 interactions — the DOMiNO deadlock this prompt closes — even with nothing selected yet', () => {
    expect(shouldShowFirstContactGuide({ direction: 'out', hasSelection: false, neverContactedSelection: false, noOutboundEver: true })).toBe(true);
  });

  it('before any selection, an entity with a prior outbound (to someone else) does not show the guide', () => {
    expect(shouldShowFirstContactGuide({ direction: 'out', hasSelection: false, neverContactedSelection: false, noOutboundEver: false })).toBe(false);
  });

  it('once a person is selected, defers entirely to the per-selection check, not noOutboundEver', () => {
    expect(shouldShowFirstContactGuide({ direction: 'out', hasSelection: true, neverContactedSelection: true, noOutboundEver: false })).toBe(true);
    expect(shouldShowFirstContactGuide({ direction: 'out', hasSelection: true, neverContactedSelection: false, noOutboundEver: true })).toBe(false);
  });
});
