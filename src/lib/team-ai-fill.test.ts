import { describe, it, expect } from 'vitest';
import { rawTeamFillToResult, rawTeamResearchToResult, type RosterMember } from './team-ai-fill';

const ROSTER: RosterMember[] = [
  { id: 'p1', fullName: 'Nuno Marujo', title: 'CEO' },
  { id: 'p2', fullName: 'Jane Doe', title: 'CTO' },
];

describe('rawTeamFillToResult', () => {
  it('maps a well-formed response to the roster by name', () => {
    const out = rawTeamFillToResult({
      members: [{ person_name: 'Nuno Marujo', bio: 'Founder with a healthtech background.' }],
      team_synergy: 'Strong technical and commercial complementarity.',
    }, ROSTER);
    expect(out).toEqual({
      members: [{ personId: 'p1', personName: 'Nuno Marujo', bio: 'Founder with a healthtech background.' }],
      teamSynergy: 'Strong technical and commercial complementarity.',
    });
  });

  it('never invents a person outside the given roster', () => {
    const out = rawTeamFillToResult({
      members: [{ person_name: 'Someone Else', bio: 'A made-up bio.' }],
      team_synergy: 'x',
    }, ROSTER);
    expect(out.members).toEqual([]);
  });

  it('matches names case-insensitively and ignores extra whitespace', () => {
    const out = rawTeamFillToResult({ members: [{ person_name: '  nuno   marujo ', bio: 'Bio text.' }], team_synergy: 'x' }, ROSTER);
    expect(out.members[0].personId).toBe('p1');
  });

  it('drops a member entry with an empty bio', () => {
    const out = rawTeamFillToResult({ members: [{ person_name: 'Nuno Marujo', bio: '   ' }], team_synergy: 'x' }, ROSTER);
    expect(out.members).toEqual([]);
  });

  it('never throws on malformed/absent input', () => {
    expect(rawTeamFillToResult(null, ROSTER)).toEqual({ members: [], teamSynergy: null });
    expect(rawTeamFillToResult({}, ROSTER)).toEqual({ members: [], teamSynergy: null });
    expect(rawTeamFillToResult('not an object', ROSTER)).toEqual({ members: [], teamSynergy: null });
  });
});

describe('rawTeamResearchToResult', () => {
  it('parses facts alongside members, matched to the same roster', () => {
    const out = rawTeamResearchToResult({
      members: [{ person_name: 'Jane Doe', bio: 'CTO with a strong ML background.' }],
      team_synergy: 'x',
      facts: [{ person_name: 'Jane Doe', statement: 'Published research on distributed systems.', confidence: 0.8, source_url: 'https://example.com/jane' }],
    }, ROSTER);
    expect(out.facts).toEqual([
      { personId: 'p2', personName: 'Jane Doe', statement: 'Published research on distributed systems.', confidence: 0.8, sourceUrl: 'https://example.com/jane' },
    ]);
  });

  it('drops a fact with no real source URL', () => {
    const out = rawTeamResearchToResult({
      members: [], team_synergy: null,
      facts: [{ person_name: 'Jane Doe', statement: 'x', confidence: 0.5, source_url: 'not-a-url' }],
    }, ROSTER);
    expect(out.facts).toEqual([]);
  });

  it('drops a fact for a person outside the roster', () => {
    const out = rawTeamResearchToResult({
      members: [], team_synergy: null,
      facts: [{ person_name: 'Nobody', statement: 'x', confidence: 0.5, source_url: 'https://example.com' }],
    }, ROSTER);
    expect(out.facts).toEqual([]);
  });

  it('never throws on malformed/absent facts', () => {
    expect(rawTeamResearchToResult({ members: [], team_synergy: null }, ROSTER).facts).toEqual([]);
    expect(rawTeamResearchToResult(null, ROSTER).facts).toEqual([]);
  });

  // Prompt 376 §B — a fact statement leaking into the bio prose (the real
  // ablute_ "based in Braga"/"ESTG" case) gets stripped from the bio, but
  // stays in facts[] for the founder to review.
  it('strips a bio sentence that duplicates an unapproved fact', () => {
    const out = rawTeamResearchToResult({
      members: [{ person_name: 'Jane Doe', bio: 'CTO with a strong ML background. She is also based in Braga.' }],
      team_synergy: 'x',
      facts: [{ person_name: 'Jane Doe', statement: 'based in Braga', confidence: 0.7, source_url: 'https://example.com/jane' }],
    }, ROSTER);
    expect(out.members[0].bio).not.toMatch(/Braga/);
    expect(out.facts[0].statement).toBe('based in Braga');
  });

  // Prompt 376 §D — the real ablute_ case: an unsourced HQ claim
  // ("headquarters in Porto") gets stripped from the bio regardless of
  // whether any fact backs it.
  it('strips an unverified HQ claim from the bio, independent of facts', () => {
    const out = rawTeamResearchToResult({
      members: [{ person_name: 'Nuno Marujo', bio: 'He leads the company from its headquarters in Porto. Strong technical background.' }],
      team_synergy: 'x', facts: [],
    }, ROSTER, { hqCity: 'Viana do Castelo' });
    expect(out.members[0].bio).not.toMatch(/Porto/);
  });

  // Prompt 376 §C — fixture: orgs.founded_year=2020, web fact says "founded
  // in 2019" — devolve conflito com os dois valores, e a confiança fica
  // rebaixada, nunca a 100%.
  it('detects a founded-year conflict and caps the fact\'s confidence', () => {
    const out = rawTeamResearchToResult({
      members: [], team_synergy: null,
      facts: [{ person_name: 'Nuno Marujo', statement: 'Ablute was founded in 2019 in Portugal.', confidence: 1, source_url: 'https://example.com/ablute' }],
    }, ROSTER, { foundedYear: 2020 });
    expect(out.conflicts).toEqual([
      { personId: 'p1', personName: 'Nuno Marujo', statement: 'Ablute was founded in 2019 in Portugal.', sourceUrl: 'https://example.com/ablute', field: 'founded_year', webValue: 2019, appValue: 2020 },
    ]);
    expect(out.facts[0].confidence).toBeLessThan(1);
  });

  it('no conflict when the web fact agrees with founded_year', () => {
    const out = rawTeamResearchToResult({
      members: [], team_synergy: null,
      facts: [{ person_name: 'Nuno Marujo', statement: 'Founded in 2020.', confidence: 0.9, source_url: 'https://example.com' }],
    }, ROSTER, { foundedYear: 2020 });
    expect(out.conflicts).toEqual([]);
    expect(out.facts[0].confidence).toBe(0.9);
  });
});
