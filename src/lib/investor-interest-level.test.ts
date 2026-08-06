import { describe, expect, it } from 'vitest';
import { currentInterestLevel, projectDossier, LEVEL_FIELDS, type FullDossierData } from './investor-interest-level';

describe('currentInterestLevel', () => {
  it('no decision, no rows -> 0', () => {
    expect(currentInterestLevel(null, [])).toBe(0);
  });
  it('interested, no rows -> 1', () => {
    expect(currentInterestLevel('interested', [])).toBe(1);
  });
  it('level 2 granted -> 2', () => {
    expect(currentInterestLevel('interested', [{ level: 2, status: 'granted' }])).toBe(2);
  });
  it('level 3 pending does not count as 3 — floors at 2', () => {
    expect(currentInterestLevel('interested', [{ level: 3, status: 'pending' }])).toBe(2);
  });
  it('level 3 granted -> 3', () => {
    expect(currentInterestLevel('interested', [{ level: 2, status: 'granted' }, { level: 3, status: 'granted' }])).toBe(3);
  });
  it('passed collapses to 0 even with levels 2 and 3 granted', () => {
    expect(currentInterestLevel('passed', [{ level: 2, status: 'granted' }, { level: 3, status: 'granted' }])).toBe(0);
  });
});

const FULL: FullDossierData = {
  overview: {
    description: 'A startup.', sectors: ['health'], stage: 'seed', foundedYear: 2024, hqCity: 'Lisbon', country: 'PT',
    roundTargetEur: 1000000, roundValuationEur: 5000000, roundValuationBasis: 'pre_money', roundMinTicketEur: 10000, roundInstruments: ['equity'],
  },
  tractionDetailed: { mrr: '10k' },
  team: [{ id: 'p1', fullName: 'Nuno Marujo', title: 'CEO', isFounder: true, linkedinUrl: 'https://linkedin.com/in/nuno', email: 'nuno@ablute.pt' }],
  contactHistory: [{ id: 'e1', at: '2026-08-01T00:00:00.000Z', content: 'Call', channel: 'call' }],
  documentTitles: [{ id: 'd1', name: 'Pitch Deck.pdf' }],
};

describe('projectDossier', () => {
  it('level 0 has no keys beyond `level`', () => {
    const result = projectDossier(0, FULL, false);
    expect(Object.keys(result)).toEqual(['level']);
  });

  it('level 1 exposes only overview', () => {
    const result = projectDossier(1, FULL, false);
    expect(result.overview).toEqual(FULL.overview);
    expect('team' in result).toBe(false);
    expect('tractionDetailed' in result).toBe(false);
    expect('contactHistory' in result).toBe(false);
    expect('documentTitles' in result).toBe(false);
    expect('canMessageNamedPerson' in result).toBe(false);
  });

  it('level 2 exposes team/traction/contact-history/document-titles but not messaging capability, and never an email', () => {
    const result = projectDossier(2, FULL, false);
    expect(result.team).toEqual([{ id: 'p1', fullName: 'Nuno Marujo', title: 'CEO', isFounder: true, linkedinUrl: 'https://linkedin.com/in/nuno' }]);
    expect((result.team as { email?: string }[])[0].email).toBeUndefined();
    expect(result.tractionDetailed).toEqual(FULL.tractionDetailed);
    expect(result.contactHistory).toEqual(FULL.contactHistory);
    expect(result.documentTitles).toEqual(FULL.documentTitles);
    expect('canMessageNamedPerson' in result).toBe(false);
    expect('canRequestDataRoom' in result).toBe(false);
  });

  it('level 3 without shareEmail still withholds the email', () => {
    const result = projectDossier(3, FULL, false);
    expect(result.canMessageNamedPerson).toBe(true);
    expect(result.canRequestDataRoom).toBe(true);
    expect((result.team as { email?: string }[])[0].email).toBeUndefined();
  });

  it('level 3 WITH shareEmail includes the email — the only path an email can ever reach the client', () => {
    const result = projectDossier(3, FULL, true);
    expect((result.team as { email?: string }[])[0].email).toBe('nuno@ablute.pt');
  });

  it('shareEmail=true at level 2 (should be impossible in practice) still never leaks the email', () => {
    const result = projectDossier(2, FULL, true);
    expect((result.team as { email?: string }[])[0].email).toBeUndefined();
  });

  // §10.3 — fails if projectDossier's own output keys drift from the §6
  // table (LEVEL_FIELDS) without both being updated together.
  for (const level of [0, 1, 2, 3] as const) {
    it(`level ${level}'s output keys match LEVEL_FIELDS[${level}] exactly`, () => {
      const result = projectDossier(level, FULL, true);
      const keys = Object.keys(result).filter((k) => k !== 'level').sort();
      expect(keys).toEqual([...LEVEL_FIELDS[level]].sort());
    });
  }
});
