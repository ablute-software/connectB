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
});
