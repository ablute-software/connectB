import { describe, expect, it } from 'vitest';
import { assertsAbsence, fallbackQuestion, scrubAbsenceClaims } from './bio-absence-guard';
import { rawTeamFillToResult, type RosterMember } from './team-ai-fill';

const ROSTER: RosterMember[] = [
  { id: 'p1', fullName: 'Nuno Marujo', title: 'CTO' },
  { id: 'p2', fullName: 'Alexandra', title: 'CCO' },
];

describe('the absence sentence never reaches a founder (Prompt 613 §C.3)', () => {
  it('catches the sentence that actually shipped', () => {
    // Production, 2026-09-08, on a person whose LinkedIn URL was on file and
    // correct — the material existed and the fetch had silently failed.
    const shipped = 'Nuno Marujo serves as CTO of the company. No additional information was provided in the materials.';
    const out = scrubAbsenceClaims(shipped);
    expect(out.text).toBe('Nuno Marujo serves as CTO of the company.');
    expect(out.removed).toEqual(['No additional information was provided in the materials.']);
  });

  it('catches the other ways a model announces its own ignorance', () => {
    for (const s of [
      'No further details were available.',
      'Nothing else was found about this person.',
      'The materials provided do not contain information about her background.',
      'There is insufficient information to write a bio.',
      'No public information was found.',
      'Unable to verify his role.',
      'Could not find anything about this person.',
    ]) {
      expect({ s, asserts: assertsAbsence(s) }).toEqual({ s, asserts: true });
    }
  });

  it('leaves real biography alone, including sentences that merely contain "no"', () => {
    for (const s of [
      'She led the no-code platform team at Feedzai for four years.',
      'He holds an MBA from USC and a degree in Design from UNIPVC.',
      'Previously a Board Member at INVICTUS, S.A., from 2004 to 2012.',
    ]) {
      expect({ s, asserts: assertsAbsence(s) }).toEqual({ s, asserts: false });
    }
  });

  it('an entirely absence-shaped bio scrubs to empty rather than to something false', () => {
    expect(scrubAbsenceClaims('No additional information was provided.').text).toBe('');
    expect(scrubAbsenceClaims('   ').text).toBe('');
    expect(scrubAbsenceClaims(null).text).toBe('');
  });

  it('the fallback question asks for the one thing that would help', () => {
    const q = fallbackQuestion('Nuno Marujo', 'CTO');
    expect(q).toContain('Nuno');
    expect(q).toContain('CTO');
    expect(q.endsWith('?')).toBe(true);
    // The question has to survive its own guard — otherwise the scrubber
    // would delete the very thing that replaces the deleted sentence.
    expect(assertsAbsence(q)).toBe(false);
    expect(scrubAbsenceClaims(q).text).toBe(q);
  });
});

describe('the parser turns an empty draft into a question, not a bio (Prompt 613 §C.3/§D)', () => {
  it('a member whose whole bio was an absence claim becomes a question', () => {
    const out = rawTeamFillToResult({
      members: [{ person_name: 'Nuno Marujo', bio: 'No additional information was provided in the materials.' }],
      team_synergy: 'x',
    }, ROSTER);
    // Never in members: the review panel's "Replace" writes the draft over the
    // saved bio, so an empty draft there is a one-click way to erase one.
    expect(out.members).toEqual([]);
    expect(out.questions).toHaveLength(1);
    expect(out.questions[0].personId).toBe('p1');
    expect(out.questions[0].question).toContain('Nuno');
  });

  it('prefers the model\'s own question when it asked one', () => {
    const out = rawTeamFillToResult({
      members: [{ person_name: 'Alexandra', question: 'Which accounts has Alexandra closed herself?' }],
      team_synergy: 'x',
    }, ROSTER);
    expect(out.questions[0].question).toBe('Which accounts has Alexandra closed herself?');
  });

  it('keeps the three narrative parts, and strips an absence claim from any of them', () => {
    const out = rawTeamFillToResult({
      members: [{
        person_name: 'Nuno Marujo',
        positioning: 'The person who has already built the thing this company sells.',
        proof_points: [
          { statement: 'Shipped the first release of the platform in 2024.', source: 'Pitch deck, p.9' },
          { statement: 'No further details were available.', source: 'LinkedIn' },
        ],
        connection: 'He is the reason the roadmap is a schedule rather than a hope.',
      }],
      team_synergy: 'x',
    }, ROSTER);
    const m = out.members[0];
    expect(m.positioning).toBe('The person who has already built the thing this company sells.');
    expect(m.proofPoints).toEqual([{ statement: 'Shipped the first release of the platform in 2024.', source: 'Pitch deck, p.9' }]);
    expect(m.connection).toContain('roadmap');
    expect(out.questions).toEqual([]);
  });

  it('caps proof points at three, so a bio cannot become a CV again', () => {
    const out = rawTeamFillToResult({
      members: [{
        person_name: 'Nuno Marujo',
        proof_points: [1, 2, 3, 4, 5].map((n) => ({ statement: `Point ${n}.`, source: 'CV' })),
      }],
      team_synergy: 'x',
    }, ROSTER);
    expect(out.members[0].proofPoints).toHaveLength(3);
  });
});
