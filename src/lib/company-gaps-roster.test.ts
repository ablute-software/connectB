import { describe, expect, it } from 'vitest';
import { ruleG3, ruleG3c, type GapContext } from './company-gaps';
import type { CompanyClaim } from './types';

// Prompt 613 §B — the acceptance criterion, written against the exact roster
// that was in production on 2026-09-08 for org 48a7c481… (Sherlock Deal):
// three people, all founders, all with LinkedIn and a bio, one titled CTO.
//
// Both sentences the panel showed beside that roster were false. The cause was
// not a wording bug: the rules counted names inside team CLAIMS while the
// founder had filled in company_people, and nothing connected the two. So the
// test is written against the roster, because that is the thing that was
// being ignored.
const PRODUCTION_ROSTER = [
  { id: 'p1', fullName: 'Sherlock', title: 'CEO', isFounder: true },
  { id: 'p2', fullName: 'Nuno Marujo', title: 'CTO', isFounder: true },
  { id: 'p3', fullName: 'Alexandra', title: 'CCO', isFounder: true },
];

const context = (over: Partial<GapContext> = {}): GapContext => ({
  founders: PRODUCTION_ROSTER.map((p) => ({ name: p.fullName })),
  roster: PRODUCTION_ROSTER,
  stage: 'seed',
  sector: 'Digital health',
  now: new Date(),
  ...over,
});

describe('the two false sentences of Prompt 613 §B', () => {
  it('no longer says "0 named person(s)" to a founder who named three', () => {
    const gaps = ruleG3([], context());
    for (const g of gaps) {
      expect(g.message).not.toContain('named person');
    }
  });

  it('no longer says nobody leads the technical side when the roster has a CTO', () => {
    const gaps = ruleG3c([], context());
    expect(gaps.map((g) => g.meta?.functionKey)).not.toContain('technical');
  });

  it('still asks for finance at seed, because nobody on that roster owns it', () => {
    // The rule is not simply switched off — the half of it that was TRUE has
    // to keep working, or the fix trades a false alarm for a blind spot.
    const gaps = ruleG3c([], context());
    expect(gaps.map((g) => g.meta?.functionKey)).toContain('financial');
  });

  it('still says nobody leads the technical side when the roster really has no one', () => {
    const gaps = ruleG3c([], context({ roster: [{ id: 'p1', fullName: 'Sherlock', title: 'CEO', isFounder: true }] }));
    expect(gaps.map((g) => g.meta?.functionKey)).toContain('technical');
  });

  it('a caller with no roster at all behaves exactly as before', () => {
    // `roster` absent means "I do not know", never "it is empty" — a caller
    // that has not been updated must not start getting different answers.
    const withoutRoster = ruleG3c([], { founders: [], stage: 'seed', now: new Date() });
    expect(withoutRoster.map((g) => g.meta?.functionKey)).toContain('technical');
    expect(ruleG3([]).some((g) => g.message.includes('only 0 named person'))).toBe(true);
  });

  it('a team claim naming someone still counts, so the two sources add up', () => {
    const claim = {
      id: 'e1', orgId: 'o', category: 'equipa', statement: 'Ana Silva is our CTO and led engineering at Feedzai.',
      evidenceClass: 3, specificity: 'high', sourceKind: 'founder_answer', status: 'accepted',
      createdAt: new Date().toISOString(),
    } as unknown as CompanyClaim;
    const gaps = ruleG3c([claim], { founders: [], stage: 'pre-seed', now: new Date() });
    expect(gaps).toEqual([]);
  });
});
