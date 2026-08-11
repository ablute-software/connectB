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
  // table (LEVEL_FIELDS) without both being updated together. Called with
  // no `swot` arg (defaults to undefined) — LEVEL_FIELDS deliberately never
  // lists `swot` (see its own comment), so this must keep passing exactly
  // as-is once swot support lands, not just today.
  for (const level of [0, 1, 2, 3] as const) {
    it(`level ${level}'s output keys match LEVEL_FIELDS[${level}] exactly`, () => {
      const result = projectDossier(level, FULL, true);
      const keys = Object.keys(result).filter((k) => k !== 'level').sort();
      expect(keys).toEqual([...LEVEL_FIELDS[level]].sort());
    });
  }
});

// Prompt 166 §D — the SWOT gate: level >= 1 AND the founder's own
// swot_visible_to_investors toggle, both required, either checked at either
// layer (route.ts's own gate before fetching + this function's own gate on
// the way out).
const SWOT_DATA = { strengths: ['s1'], weaknesses: ['w1'], opportunities: ['o1'], threats: ['t1'] };

describe('projectDossier — swot', () => {
  it('level 0, visible=true — still absent (level gate wins)', () => {
    const result = projectDossier(0, FULL, false, { visible: true, data: SWOT_DATA });
    expect('swot' in result).toBe(false);
  });

  it('level 1, visible=true — present, exactly the 4 arrays', () => {
    const result = projectDossier(1, FULL, false, { visible: true, data: SWOT_DATA });
    expect(result.swot).toEqual(SWOT_DATA);
  });

  it('level 3, visible=false — absent regardless of level', () => {
    const result = projectDossier(3, FULL, false, { visible: false, data: SWOT_DATA });
    expect('swot' in result).toBe(false);
  });

  it('level 1, swot arg omitted entirely — absent, no throw', () => {
    const result = projectDossier(1, FULL, false);
    expect('swot' in result).toBe(false);
  });

  it('level 1, visible=true but no run yet (data undefined) — absent, not an empty object', () => {
    const result = projectDossier(1, FULL, false, { visible: true, data: undefined as unknown as typeof SWOT_DATA });
    expect('swot' in result).toBe(false);
  });
});

// Prompt 168 §D — founderClarifications: already pre-filtered to
// visible_to_investors=true by the caller; this function's own job is just
// the level gate plus "empty list means absent, not an empty array".
describe('projectDossier — founderClarifications', () => {
  const CLARIFICATIONS = [{ category: 'weaknesses' as const, text: 'Fixed since the last round.' }];

  it('level 0 — absent (level gate wins)', () => {
    const result = projectDossier(0, FULL, false, null, CLARIFICATIONS);
    expect('founderClarifications' in result).toBe(false);
  });

  it('level 1 — present, exactly what the caller passed', () => {
    const result = projectDossier(1, FULL, false, null, CLARIFICATIONS);
    expect(result.founderClarifications).toEqual(CLARIFICATIONS);
  });

  it('empty array — absent, not an empty array (N=0 means the section does not appear)', () => {
    const result = projectDossier(1, FULL, false, null, []);
    expect('founderClarifications' in result).toBe(false);
  });

  it('arg omitted entirely — absent, no throw', () => {
    const result = projectDossier(1, FULL, false, null);
    expect('founderClarifications' in result).toBe(false);
  });
});
